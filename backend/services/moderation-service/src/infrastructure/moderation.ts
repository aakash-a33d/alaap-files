/**
 * Verdicts, reports and appeals. community_vault, moderation-service's own tables.
 *
 * The grants draw a line this file stays on the right side of: moderation-service may
 * read content and may change a post or comment's STATE, but has no write on any body.
 * It cannot edit what it judges.
 */

import { Pool } from 'pg';

export interface Verdict {
  id: string;
  decision: string;
  categories: string[];
  modelVersion: string;
  decidedAt: string;
}

export interface Report {
  id: string;
  reasonCode: string;
  createdAt: string;
  resolvedAt: string | undefined;
  outcome: string | undefined;
}

export interface Appeal {
  id: string;
  verdictId: string;
  state: string;
  createdAt: string;
  resolvedAt: string | undefined;
}

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
export function createModerationPool(
  connectionString: string,
  log?: { error(o: object, m?: string): void },
): Pool {
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    application_name: 'alaap-moderation-service',
  });
  pool.on('error', (err) => {
    log?.error({ err: err.message }, 'idle database client failed; pool will recover');
  });
  return pool;
}

export class ModerationRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /** The policy version in force. Verdicts reference it so an appeal can be judged
   *  against the rules that applied when the decision was made, not today's. */
  async currentPolicyVersion(): Promise<number> {
    const { rows } = await this.pool.query<{ version: number }>(
      `SELECT version FROM moderation_policy_versions
        WHERE retired_at IS NULL ORDER BY version DESC LIMIT 1`,
    );
    const version = rows[0]?.version;
    if (version === undefined) {
      // Fail loudly. A verdict cannot be written without one, so continuing would mean
      // moderating without recording it — which is worse than refusing.
      throw new Error(
        'no active moderation policy version. Run scripts/db/migrate.mjs, which seeds it.',
      );
    }
    return version;
  }

  /** Record a decision about a comment. Returns the verdict id an appeal points at. */
  async recordCommentVerdict(params: {
    commentRef: string;
    decision: string;
    categories: string[];
    modelId: string;
    modelVersion: string;
    policyVersion: number;
    latencyMs: number;
  }): Promise<Verdict | undefined> {
    const { rows } = await this.pool.query<{
      id: string;
      decision: string;
      categories: string[];
      model_version: string;
      decided_at: Date;
    }>(
      `INSERT INTO moderation_verdicts
         (subject_type, subject_comment_id, decision, categories,
          model_id, model_version, policy_version, latency_ms)
       SELECT 'comment', c.id, $2, $3, $4, $5, $6, $7
         FROM community_comments c
        WHERE c.public_ref = $1
       RETURNING id, decision, categories, model_version, decided_at`,
      [
        params.commentRef,
        params.decision,
        params.categories,
        params.modelId,
        params.modelVersion,
        params.policyVersion,
        params.latencyMs,
      ],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    return {
      id: row.id,
      decision: row.decision,
      categories: row.categories,
      modelVersion: row.model_version,
      decidedAt: row.decided_at.toISOString(),
    };
  }

  /**
   * The verdict a member may appeal against.
   *
   * Scoped to the appellant in the WHERE clause, not checked afterwards: this is the
   * only thing standing between a member and appealing somebody else's decision, which
   * would disclose that a particular reply existed and was blocked.
   */
  async verdictForAuthor(verdictId: string, pseudoId: number): Promise<Verdict | undefined> {
    const { rows } = await this.pool.query<{
      id: string;
      decision: string;
      categories: string[];
      model_version: string;
      decided_at: Date;
    }>(
      `SELECT v.id, v.decision, v.categories, v.model_version, v.decided_at
         FROM moderation_verdicts v
         JOIN community_comments c ON c.id = v.subject_comment_id
        WHERE v.id = $1 AND c.author_pseudo_id = $2`,
      [verdictId, pseudoId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    return {
      id: row.id,
      decision: row.decision,
      categories: row.categories,
      modelVersion: row.model_version,
      decidedAt: row.decided_at.toISOString(),
    };
  }

  /**
   * File a report.
   *
   * The reporter's pseudo id is stored. That is a deliberate cost: it makes a
   * retaliatory reporting campaign visible, and it lets a reviewer tell one person
   * reporting fifty posts from one person reported by fifty. It is never shown to the
   * person reported, and nothing in the API returns it.
   */
  async createReport(params: {
    reporterPseudoId: number;
    subjectType: 'post' | 'comment';
    subjectRef: string;
    reasonCode: string;
    note: string | undefined;
  }): Promise<Report | undefined> {
    const column = params.subjectType === 'post' ? 'subject_post_id' : 'subject_comment_id';
    const table = params.subjectType === 'post' ? 'community_posts' : 'community_comments';

    const { rows } = await this.pool.query<{
      id: string;
      reason_code: string;
      created_at: Date;
      resolved_at: Date | null;
      outcome: string | null;
    }>(
      `INSERT INTO user_reports
         (reporter_pseudo_id, subject_type, ${column}, reason_code, note)
       SELECT $1, $2, s.id, $3, $4 FROM ${table} s WHERE s.public_ref = $5
       RETURNING id, reason_code, created_at, resolved_at, outcome`,
      [
        params.reporterPseudoId,
        params.subjectType,
        params.reasonCode,
        params.note ?? null,
        params.subjectRef,
      ],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    return {
      id: row.id,
      reasonCode: row.reason_code,
      createdAt: row.created_at.toISOString(),
      resolvedAt: row.resolved_at?.toISOString(),
      outcome: row.outcome ?? undefined,
    };
  }

  /** Whether this member has already reported this thing. Reports are idempotent per
   *  reporter: a second one adds nothing to a queue and dilutes the count a reviewer
   *  uses to judge how many DIFFERENT people objected. */
  async hasReported(
    reporterPseudoId: number,
    subjectType: 'post' | 'comment',
    subjectRef: string,
  ): Promise<boolean> {
    const column = subjectType === 'post' ? 'subject_post_id' : 'subject_comment_id';
    const table = subjectType === 'post' ? 'community_posts' : 'community_comments';
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM user_reports r
         JOIN ${table} s ON s.id = r.${column}
        WHERE r.reporter_pseudo_id = $1 AND s.public_ref = $2`,
      [reporterPseudoId, subjectRef],
    );
    return Number(rows[0]?.n ?? 0) > 0;
  }

  async createAppeal(params: {
    verdictId: string;
    appellantPseudoId: number;
    statement: string | undefined;
  }): Promise<Appeal> {
    const { rows } = await this.pool.query<{
      id: string;
      verdict_id: string;
      state: string;
      created_at: Date;
      resolved_at: Date | null;
    }>(
      `INSERT INTO moderation_appeals (verdict_id, appellant_pseudo_id, statement)
       VALUES ($1, $2, $3)
       RETURNING id, verdict_id, state, created_at, resolved_at`,
      [params.verdictId, params.appellantPseudoId, params.statement ?? null],
    );
    const row = rows[0]!;
    return {
      id: row.id,
      verdictId: row.verdict_id,
      state: row.state,
      createdAt: row.created_at.toISOString(),
      resolvedAt: row.resolved_at?.toISOString(),
    };
  }

  async openAppealFor(verdictId: string): Promise<Appeal | undefined> {
    const { rows } = await this.pool.query<{
      id: string;
      verdict_id: string;
      state: string;
      created_at: Date;
      resolved_at: Date | null;
    }>(
      `SELECT id, verdict_id, state, created_at, resolved_at
         FROM moderation_appeals
        WHERE verdict_id = $1 AND state IN ('open','under_review')`,
      [verdictId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    return {
      id: row.id,
      verdictId: row.verdict_id,
      state: row.state,
      createdAt: row.created_at.toISOString(),
      resolvedAt: row.resolved_at?.toISOString(),
    };
  }

  /** A member's own appeals, so they can see where each one got to. */
  async appealsFor(pseudoId: number): Promise<Appeal[]> {
    const { rows } = await this.pool.query<{
      id: string;
      verdict_id: string;
      state: string;
      created_at: Date;
      resolved_at: Date | null;
    }>(
      `SELECT id, verdict_id, state, created_at, resolved_at
         FROM moderation_appeals
        WHERE appellant_pseudo_id = $1
        ORDER BY created_at DESC LIMIT 50`,
      [pseudoId],
    );
    return rows.map((r) => ({
      id: r.id,
      verdictId: r.verdict_id,
      state: r.state,
      createdAt: r.created_at.toISOString(),
      resolvedAt: r.resolved_at?.toISOString(),
    }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
