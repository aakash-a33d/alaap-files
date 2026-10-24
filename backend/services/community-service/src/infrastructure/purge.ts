/**
 * Removing a member from the community vault, and handing back what they wrote.
 *
 * retention-service orchestrates a deletion but holds no credential on this vault —
 * it cannot even open the database. The purge happens here because this is where the
 * foreign keys, the states and the legal holds are understood.
 *
 * WHAT LEGAL HOLD DOES
 *
 * A post retained for an appeal or an abuse investigation is not purged. It is
 * reported back by count, the request is recorded as partial rather than complete, and
 * the member is told which records survived and why. Reporting a deletion as finished
 * while records remain is a lie the audit trail would eventually expose; blocking the
 * whole deletion on one held post punishes the member for somebody else's appeal.
 *
 * WHAT GOES, THAT PEOPLE MIGHT NOT EXPECT
 *
 * Replies to other people. A reply that helped somebody disappears from their thread,
 * which is a real cost. The member wrote those words, their right to erasure is the
 * stronger claim, and a tombstone reading "deleted by author" would still disclose that
 * a particular person had been there and then left.
 */

import type { Pool } from 'pg';

export interface PurgeReport {
  /** Rows actually removed, across every table this service owns. */
  purged: number;
  /** Rows that survived a legal hold, and must be reported to the member. */
  held: number;
  /** One line per held record, in words a member can act on. */
  detail: string[];
}

export interface CommunityExport {
  posts: {
    ref: string;
    categoryId: string;
    body: string;
    createdAt: string;
    expiresAt: string | null;
  }[];
  replies: {
    ref: string;
    body: string;
    /** The post it answered. The post's own text is not included — see below. */
    inReplyToPost: string;
    createdAt: string;
  }[];
  /**
   * The AI's replies on this member's own posts.
   *
   * Separate from `replies`, and that separation is the whole point. B1's reply is
   * stored against the post author's pseudo_id because the column is NOT NULL and must
   * reference a real persona — `source = 'ai'` is what distinguishes it. The export
   * query filtered on the author alone, so the AI's words came back inside the
   * member's own replies, under a notice that reads "Everything here was written by
   * you". It was not.
   *
   * They belong in the file: they were written to this member, about what they said,
   * and are part of their record. They just are not theirs.
   */
  aiResponses: { ref: string; body: string; onPost: string; createdAt: string }[];
}

export class CommunityPurge {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Everything the member wrote here.
   *
   * Their posts and their replies, and nothing else. A reply carries the reference of
   * the post it answered but NOT that post's text: a thread contains other people's
   * words, and "my data" does not extend to what somebody else said to me.
   */
  async exportFor(pseudoId: number): Promise<CommunityExport> {
    const posts = await this.pool.query<{
      public_ref: string;
      category_id: string;
      body: string;
      created_at: Date;
      expires_at: Date | null;
    }>(
      `SELECT public_ref, category_id, body, created_at, expires_at
         FROM community_posts
        WHERE author_pseudo_id = $1 AND deleted_at IS NULL
        ORDER BY created_at`,
      [pseudoId],
    );

    // `source = 'peer'` is what makes this the member's own words. Without it the
    // AI's reply on their own post comes back as though they wrote it.
    const replies = await this.pool.query<{
      public_ref: string;
      body: string;
      post_ref: string;
      created_at: Date;
    }>(
      `SELECT c.public_ref, c.body, p.public_ref AS post_ref, c.created_at
         FROM community_comments c
         JOIN community_posts p ON p.id = c.post_id
        WHERE c.author_pseudo_id = $1 AND c.source = 'peer' AND c.deleted_at IS NULL
        ORDER BY c.created_at`,
      [pseudoId],
    );

    const aiReplies = await this.pool.query<{
      public_ref: string;
      body: string;
      post_ref: string;
      created_at: Date;
    }>(
      `SELECT c.public_ref, c.body, p.public_ref AS post_ref, c.created_at
         FROM community_comments c
         JOIN community_posts p ON p.id = c.post_id
        WHERE c.author_pseudo_id = $1 AND c.source = 'ai' AND c.deleted_at IS NULL
        ORDER BY c.created_at`,
      [pseudoId],
    );

    return {
      posts: posts.rows.map((r) => ({
        ref: r.public_ref,
        categoryId: r.category_id,
        body: r.body,
        createdAt: r.created_at.toISOString(),
        expiresAt: r.expires_at === null ? null : r.expires_at.toISOString(),
      })),
      replies: replies.rows.map((r) => ({
        ref: r.public_ref,
        body: r.body,
        inReplyToPost: r.post_ref,
        createdAt: r.created_at.toISOString(),
      })),
      aiResponses: aiReplies.rows.map((r) => ({
        ref: r.public_ref,
        body: r.body,
        onPost: r.post_ref,
        createdAt: r.created_at.toISOString(),
      })),
    };
  }

  /**
   * Remove the member from this vault.
   *
   * One transaction. A deletion that half-succeeded would leave replies pointing at a
   * member whose posts are gone, and the member with no way to tell what remains.
   */
  async purge(pseudoId: number): Promise<PurgeReport> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const held = await client.query<{ public_ref: string }>(
        `SELECT public_ref FROM community_posts
          WHERE author_pseudo_id = $1 AND legal_hold AND deleted_at IS NULL`,
        [pseudoId],
      );

      // Comments first: they reference posts.
      const comments = await client.query(
        `DELETE FROM community_comments WHERE author_pseudo_id = $1`,
        [pseudoId],
      );

      const posts = await client.query(
        `DELETE FROM community_posts WHERE author_pseudo_id = $1 AND NOT legal_hold`,
        [pseudoId],
      );

      const restrictions = await client.query(
        `DELETE FROM account_restrictions WHERE pseudo_id = $1`,
        [pseudoId],
      );

      // The persona row is pseudonym-service's, not this service's. It is purged
      // through that service's own endpoint — this one has SELECT on it and nothing
      // more, and reaching across that line here would be the first crack in the
      // co-tenancy the grants exist to enforce.

      await client.query('COMMIT');

      const detail =
        held.rowCount === 0
          ? []
          : [
              `${held.rowCount} ${held.rowCount === 1 ? 'post is' : 'posts are'} held for a ` +
                `moderation appeal or safety review and could not be deleted yet. ` +
                `Everything else you wrote in the community is gone.`,
            ];

      return {
        purged: (comments.rowCount ?? 0) + (posts.rowCount ?? 0) + (restrictions.rowCount ?? 0),
        held: held.rowCount ?? 0,
        detail,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
