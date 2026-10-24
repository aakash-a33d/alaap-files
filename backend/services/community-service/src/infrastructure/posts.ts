/**
 * Posts and replies. community_vault, community-service's own tables.
 *
 * This service can read personas but never write one, and cannot touch the identity
 * vault at all. It holds post bodies — the most sensitive thing in this vault — and
 * nothing that says who wrote them beyond a pseudo_id.
 */

import { Pool } from 'pg';

import { generateRef } from '../domain/refs.ts';

export interface Post {
  ref: string;
  categoryId: string;
  body: string;
  state: string;
  authorPseudoId: number;
  authorHandle: string;
  createdAt: string;
  publishedAt: string | undefined;
  expiresAt: string | undefined;
  aiResponseState: string;
  replyCount: number;
}

export interface Reply {
  ref: string;
  body: string;
  state: string;
  source: string;
  authorPseudoId: number;
  authorHandle: string;
  createdAt: string;
  publishedAt: string | undefined;
}

interface PostRow {
  public_ref: string;
  category_id: string;
  body: string;
  state: string;
  author_pseudo_id: string;
  handle: string;
  created_at: Date;
  published_at: Date | null;
  expires_at: Date | null;
  ai_response_state: string;
  reply_count: string;
}

const iso = (d: Date | null): string | undefined => (d === null ? undefined : d.toISOString());

function toPost(row: PostRow): Post {
  return {
    ref: row.public_ref,
    categoryId: row.category_id,
    body: row.body,
    state: row.state,
    authorPseudoId: Number(row.author_pseudo_id),
    authorHandle: row.handle,
    createdAt: row.created_at.toISOString(),
    publishedAt: iso(row.published_at),
    expiresAt: iso(row.expires_at),
    aiResponseState: row.ai_response_state,
    replyCount: Number(row.reply_count ?? 0),
  };
}

/**
 * Joined to pseudo_profiles for the handle on every read.
 *
 * Denormalising the handle onto the post would be faster and wrong: a handle is
 * permanent today, but a persona that is suspended or deleted must stop appearing, and
 * a copy would keep showing it.
 */
const POST_SELECT = `
  SELECT p.public_ref, p.category_id, p.body, p.state, p.author_pseudo_id,
         pr.handle, p.created_at, p.published_at, p.expires_at, p.ai_response_state,
         (SELECT count(*) FROM community_comments c
           WHERE c.post_id = p.id AND c.state = 'published') AS reply_count
    FROM community_posts p
    JOIN pseudo_profiles pr ON pr.pseudo_id = p.author_pseudo_id`;

/**
 * A pool that survives the database going away.
 *
 * `pg` re-emits an idle client's connection error on the Pool itself. An 'error' event
 * with no listener is not a logged warning in Node — it is an uncaught exception, and
 * the whole service exits mid-request. A Postgres restart terminates every idle
 * connection at once (57P01), so a routine restart takes down any service that happens
 * to be holding one, at random, with no log line of its own.
 *
 * Nothing needs to be repaired here. The pool discards the dead client and the next
 * query opens a fresh one; the only thing required is to not die while that happens.
 */
export function createCommunityPool(
  connectionString: string,
  log?: { error(o: object, m?: string): void },
): Pool {
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    application_name: 'alaap-community-service',
  });
  pool.on('error', (err) => {
    log?.error({ err: err.message }, 'idle database client failed; pool will recover');
  });
  return pool;
}

export class PostRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * How many posts this member has written since `since`.
   *
   * Counts rows rather than reading a counter. A counter drifts from the rows it
   * claims to describe — a deleted post that still counts, a failed insert that does
   * not — and the drift is invisible until somebody is wrongly refused.
   *
   * Deleted posts are excluded: a member who writes and deletes has not consumed the
   * month's allowance, and the alternative punishes somebody for thinking better of it.
   * Blocked ones ARE counted — the moderation pass already cost what the quota pays for.
   */
  async countPostsSince(pseudoId: number, since: Date): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM community_posts
        WHERE author_pseudo_id = $1 AND created_at >= $2 AND state <> 'deleted'`,
      [pseudoId, since],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async countRepliesSince(pseudoId: number, since: Date): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM community_comments
        WHERE author_pseudo_id = $1 AND created_at >= $2
          AND source = 'peer' AND state <> 'deleted'`,
      [pseudoId, since],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Write a post. Published immediately.
   *
   * A member's own post is not moderated (metadata/moderation policy: every category
   * needs a recipient, and a new post has none). So there is no pending state to sit
   * in — the row is published as it is written, and only the AI response is
   * asynchronous.
   *
   * The ref is retried on collision rather than pre-checked; a check-then-insert race
   * produces exactly the duplicate the unique constraint exists to prevent.
   */
  async createPost(params: {
    pseudoId: number;
    categoryId: string;
    body: string;
    expiresAt: Date;
  }): Promise<Post> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const ref = generateRef('post');
      try {
        const { rows } = await this.pool.query<{ id: string }>(
          `INSERT INTO community_posts
             (public_ref, author_pseudo_id, category_id, body, state, published_at, expires_at)
           VALUES ($1, $2, $3, $4, 'published', now(), $5)
           RETURNING id`,
          [ref, params.pseudoId, params.categoryId, params.body, params.expiresAt],
        );
        const created = await this.findByRef(ref);
        if (created === undefined) throw new Error(`post ${rows[0]!.id} vanished after insert`);
        return created;
      } catch (err) {
        const code = (err as { code?: string }).code;
        const constraint = (err as { constraint?: string }).constraint ?? '';
        if (code === '23505' && constraint.includes('public_ref') && attempt < 9) continue;
        throw err;
      }
    }
    throw new Error('could not allocate a unique post ref after 10 attempts');
  }

  async findByRef(ref: string): Promise<Post | undefined> {
    const { rows } = await this.pool.query<PostRow>(`${POST_SELECT} WHERE p.public_ref = $1`, [ref]);
    const row = rows[0];
    return row === undefined ? undefined : toPost(row);
  }

  /**
   * The feed: published, unexpired, newest first.
   *
   * Expiry is applied HERE as well as by the job, deliberately. The job is what
   * actually changes state, but a post whose moment has passed must stop being visible
   * the instant it does, not whenever the sweep next runs — a member was promised five
   * days, not five days plus however long the cron interval is.
   */
  async feed(params: { limit: number; before?: string | undefined; categoryId?: string | undefined }): Promise<Post[]> {
    const { rows } = await this.pool.query<PostRow>(
      `${POST_SELECT}
        WHERE p.state = 'published'
          AND p.expires_at > now()
          AND ($1::text IS NULL OR p.category_id = $1::text)
          AND ($2::timestamptz IS NULL OR p.published_at < $2::timestamptz)
        ORDER BY p.published_at DESC
        LIMIT $3`,
      [params.categoryId ?? null, params.before ?? null, params.limit],
    );
    return rows.map(toPost);
  }

  /** A member's own posts, expired ones included — they wrote them. */
  async postsByAuthor(pseudoId: number, limit: number): Promise<Post[]> {
    const { rows } = await this.pool.query<PostRow>(
      `${POST_SELECT}
        WHERE p.author_pseudo_id = $1 AND p.state <> 'deleted'
        ORDER BY p.created_at DESC LIMIT $2`,
      [pseudoId, limit],
    );
    return rows.map(toPost);
  }

  /**
   * Every published reply on a post, oldest first.
   *
   * No visibility filtering. The author sees all of them, on every plan — capping what
   * somebody may READ was removed deliberately, and `assertNeverGated` in the domain is
   * the running guard against it coming back. The columns that once supported it were
   * dropped in community-vault/0005_drop_reply_visibility.sql.
   */
  async repliesFor(postRef: string): Promise<Reply[]> {
    const { rows } = await this.pool.query<{
      public_ref: string;
      body: string;
      state: string;
      source: string;
      author_pseudo_id: string;
      handle: string;
      created_at: Date;
      published_at: Date | null;
    }>(
      `SELECT c.public_ref, c.body, c.state, c.source, c.author_pseudo_id,
              pr.handle, c.created_at, c.published_at
         FROM community_comments c
         JOIN community_posts p ON p.id = c.post_id
         JOIN pseudo_profiles pr ON pr.pseudo_id = c.author_pseudo_id
        WHERE p.public_ref = $1 AND c.state = 'published'
        ORDER BY c.published_at ASC`,
      [postRef],
    );
    return rows.map((r) => ({
      ref: r.public_ref,
      body: r.body,
      state: r.state,
      source: r.source,
      authorPseudoId: Number(r.author_pseudo_id),
      authorHandle: r.handle,
      createdAt: r.created_at.toISOString(),
      publishedAt: iso(r.published_at),
    }));
  }

  /**
   * Write a reply.
   *
   * `state` is decided by the caller from the moderation verdict, and a blocked reply
   * is STORED rather than discarded. Three reasons: an appeal needs the text it is
   * appealing about, a repeat offender is only visible as a pattern if the attempts
   * exist, and a member who was wrongly blocked can be given their words back.
   */
  async createReply(params: {
    postRef: string;
    pseudoId: number;
    body: string;
    state: 'published' | 'blocked' | 'held';
  }): Promise<Reply | undefined> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const ref = generateRef('reply');
      try {
        const { rowCount } = await this.pool.query(
          `INSERT INTO community_comments
             (public_ref, post_id, author_pseudo_id, body, source, state, published_at)
           SELECT $1, p.id, $2, $3, 'peer', $4,
                  CASE WHEN $4 = 'published' THEN now() ELSE NULL END
             FROM community_posts p
            WHERE p.public_ref = $5
              AND p.state = 'published'
              AND p.expires_at > now()`,
          [ref, params.pseudoId, params.body, params.state, params.postRef],
        );
        // No row inserted means the SELECT matched nothing: no such post, or it has
        // expired. Not an error — a member can be looking at a page that went stale
        // while they were typing, which on a five-day expiry is a real occurrence.
        if ((rowCount ?? 0) === 0) return undefined;

        const replies = await this.repliesFor(params.postRef);
        return replies.find((r) => r.ref === ref) ?? {
          ref,
          body: params.body,
          state: params.state,
          source: 'peer',
          authorPseudoId: params.pseudoId,
          authorHandle: '',
          createdAt: new Date().toISOString(),
          publishedAt: undefined,
        };
      } catch (err) {
        const code = (err as { code?: string }).code;
        const constraint = (err as { constraint?: string }).constraint ?? '';
        if (code === '23505' && constraint.includes('public_ref') && attempt < 9) continue;
        throw err;
      }
    }
    throw new Error('could not allocate a unique reply ref after 10 attempts');
  }

  /**
   * Take one post awaiting its AI reply, generate under lock, and write the outcome.
   *
   * The whole thing runs inside one transaction with `FOR UPDATE SKIP LOCKED`: a
   * second worker looking at the same moment skips this row rather than queuing behind
   * it, so two workers never write two AI replies to one post. That matters more than
   * it looks — the post author would see the platform reply to them twice.
   *
   * `generate` is passed in rather than called from here so this file keeps no
   * knowledge of the AI tier, and so the transaction is the only thing this method is
   * responsible for.
   *
   * ONE ATTEMPT PER POST, ALWAYS. Success or failure, the state leaves `pending`, and
   * nothing puts it back. A retry queue would mean a post from last Tuesday suddenly
   * acquiring an AI reply days later, which reads worse than never having one.
   */
  async withPendingResponse(
    generate: (body: string) => Promise<string | undefined>,
  ): Promise<{ ref: string; wrote: boolean } | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string; public_ref: string; body: string }>(
        `SELECT id, public_ref, body FROM community_posts
          WHERE ai_response_state = 'pending'
            AND state = 'published'
            AND expires_at > now()
          ORDER BY published_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
      );
      const post = rows[0];
      if (post === undefined) {
        await client.query('ROLLBACK');
        return undefined;
      }

      const text = await generate(post.body);

      if (text === undefined) {
        // No reply is a normal outcome, and nothing is written into the thread. An
        // apology from the platform would be noise on somebody's post, and the peer
        // replies are the point.
        await client.query(
          `UPDATE community_posts SET ai_response_state = 'failed' WHERE id = $1`,
          [post.id],
        );
        await client.query('COMMIT');
        return { ref: post.public_ref, wrote: false };
      }

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const ref = generateRef('reply');
        try {
          await client.query(
            `INSERT INTO community_comments
               (public_ref, post_id, author_pseudo_id, body, source, state, published_at)
             VALUES ($1, $2, $3, $4, 'ai', 'published', now())`,
            // Attributed to the post's own author pseudo_id because the column is NOT
            // NULL and references a real persona; `source = 'ai'` is what the interface
            // reads, and what stops this being shown as a peer's words.
            [ref, post.id, await this.aiAuthorFor(client, post.id), text],
          );
          break;
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code === '23505' && attempt < 9) continue;
          throw err;
        }
      }

      await client.query(
        `UPDATE community_posts SET ai_response_state = 'ready' WHERE id = $1`,
        [post.id],
      );
      await client.query('COMMIT');
      return { ref: post.public_ref, wrote: true };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** The persona an AI reply is filed under. See the note at the insert above. */
  private async aiAuthorFor(client: { query: Pool['query'] }, postId: string): Promise<string> {
    const { rows } = await client.query<{ author_pseudo_id: string }>(
      `SELECT author_pseudo_id FROM community_posts WHERE id = $1`,
      [postId],
    );
    return rows[0]!.author_pseudo_id;
  }

  async categories(): Promise<{ id: string }[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM community_categories WHERE active ORDER BY display_order`,
    );
    return rows;
  }

  /**
   * Mark expired posts expired. Idempotent, and safe to run on any schedule.
   *
   * `legal_hold` is honoured here: a post retained for an appeal or an abuse
   * investigation keeps its state rather than being swept. It is still invisible in
   * the feed, because the feed filters on `expires_at` independently.
   */
  async expirePosts(): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE community_posts
          SET state = 'expired'
        WHERE state = 'published' AND expires_at <= now() AND NOT legal_hold`,
    );
    return rowCount ?? 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
