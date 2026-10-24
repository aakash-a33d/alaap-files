/**
 * The request ledger and its outbox. core, retention-service's own four tables.
 *
 * This service holds credentials to these tables and to nothing else on the cluster —
 * it cannot open community_vault or clinical_vault at all. The whole of its power is
 * bookkeeping plus the right to ask other services to delete.
 *
 * WHY AN OUTBOX AND NOT A QUEUE
 *
 * A job row is written in the same transaction that accepts the request, so a service
 * that dies mid-deletion resumes rather than forgetting. This platform has already lost
 * a service to a database restart mid-session; a deletion that evaporates the same way
 * would be a promise broken silently, and the member would never learn of it.
 */

import { Pool } from 'pg';

import { PURGE_ORDER } from '../config/targets.ts';

export interface DeletionRequest {
  id: string;
  pseudoId: number;
  state: string;
  requestedAt: string;
  completedAt: string | null;
  detail: string | null;
}

export interface Job {
  id: string;
  requestId: string;
  pseudoId: number;
  targetService: string;
  state: string;
  attempts: number;
}

export function createCorePool(
  connectionString: string,
  log?: { error(o: object, m?: string): void },
): Pool {
  const pool = new Pool({
    connectionString,
    max: 8,
    connectionTimeoutMillis: 5_000,
    application_name: 'alaap-retention-service',
  });
  pool.on('error', (err) => {
    log?.error({ err: err.message }, 'idle database client failed; pool will recover');
  });
  return pool;
}

export class RequestRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Accept a deletion, and write its work items in the same breath.
   *
   * One transaction: either the request and every job exist, or neither does. A request
   * with no jobs would sit as `pending` forever and report itself as in progress.
   */
  async open(pseudoId: number): Promise<DeletionRequest> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query<{
        id: string;
        pseudo_id: string;
        state: string;
        requested_at: Date;
      }>(
        `INSERT INTO data_deletion_requests (pseudo_id, state)
         VALUES ($1, 'in_progress')
         RETURNING id, pseudo_id, state, requested_at`,
        [pseudoId],
      );
      const request = rows[0]!;

      for (const target of PURGE_ORDER) {
        await client.query(
          `INSERT INTO retention_jobs (request_id, pseudo_id, target_service)
           VALUES ($1, $2, $3)`,
          [request.id, pseudoId, target.service],
        );
      }

      await client.query('COMMIT');
      return {
        id: request.id,
        pseudoId: Number(request.pseudo_id),
        state: request.state,
        requestedAt: request.requested_at.toISOString(),
        completedAt: null,
        detail: null,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Take the next job for a request, in the declared order.
   *
   * `FOR UPDATE SKIP LOCKED` so two workers never purge the same vault twice. The
   * order comes from the job's position in PURGE_ORDER rather than from its id, because
   * the order matters — the handle must go last.
   */
  async claimNext(requestId: string): Promise<Job | undefined> {
    const order = PURGE_ORDER.map((t) => t.service);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{
        id: string;
        request_id: string;
        pseudo_id: string;
        target_service: string;
        state: string;
        attempts: number;
      }>(
        `SELECT id, request_id, pseudo_id, target_service, state, attempts
           FROM retention_jobs
          WHERE request_id = $1 AND state = 'pending'
          ORDER BY array_position($2::text[], target_service)
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        [requestId, order],
      );
      const row = rows[0];
      if (row === undefined) {
        await client.query('COMMIT');
        return undefined;
      }

      await client.query(
        `UPDATE retention_jobs SET state = 'running', attempts = attempts + 1, updated_at = now()
          WHERE id = $1`,
        [row.id],
      );
      await client.query('COMMIT');

      return {
        id: row.id,
        requestId: row.request_id,
        pseudoId: Number(row.pseudo_id),
        targetService: row.target_service,
        state: 'running',
        attempts: row.attempts + 1,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Record what a purge did, and leave the evidence.
   *
   * The job row and the receipt are written together. A job marked done with no receipt
   * would be a deletion nobody can demonstrate, which is the same as one that did not
   * happen.
   */
  async finish(
    job: Job,
    outcome: 'purged' | 'held' | 'failed',
    result: { purged?: number; detail?: string },
  ): Promise<void> {
    const jobState = outcome === 'purged' ? 'done' : outcome === 'held' ? 'held' : 'failed';
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE retention_jobs
            SET state = $2, purged_count = $3, last_error = $4, updated_at = now()
          WHERE id = $1`,
        [job.id, jobState, result.purged ?? null, outcome === 'failed' ? (result.detail ?? null) : null],
      );
      await client.query(
        `INSERT INTO deletion_audit_logs
           (request_id, pseudo_id, target_service, outcome, purged_count, detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          job.requestId,
          job.pseudoId,
          job.targetService,
          outcome,
          result.purged ?? null,
          result.detail ?? null,
        ],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Close the request, with the outcome the jobs actually produced.
   *
   * `partial` is a real answer and not a softened failure: a post under legal hold
   * survives, everything else went, and the member is entitled to know both halves.
   */
  async close(requestId: string): Promise<DeletionRequest> {
    const { rows: jobs } = await this.pool.query<{ state: string }>(
      `SELECT state FROM retention_jobs WHERE request_id = $1`,
      [requestId],
    );

    const failed = jobs.filter((j) => j.state === 'failed').length;
    const held = jobs.filter((j) => j.state === 'held').length;
    const state = failed > 0 ? 'failed' : held > 0 ? 'partial' : 'completed';

    const { rows: details } = await this.pool.query<{ detail: string | null }>(
      `SELECT detail FROM deletion_audit_logs
        WHERE request_id = $1 AND detail IS NOT NULL
        ORDER BY recorded_at`,
      [requestId],
    );
    const detail = details.map((d) => d.detail).filter((d): d is string => d !== null).join(' ');

    const { rows } = await this.pool.query<{
      id: string;
      pseudo_id: string;
      state: string;
      requested_at: Date;
      completed_at: Date | null;
      detail: string | null;
    }>(
      `UPDATE data_deletion_requests
          SET state = $2, completed_at = now(), detail = NULLIF($3, '')
        WHERE id = $1
        RETURNING id, pseudo_id, state, requested_at, completed_at, detail`,
      [requestId, state, detail],
    );
    const row = rows[0]!;
    return {
      id: row.id,
      pseudoId: Number(row.pseudo_id),
      state: row.state,
      requestedAt: row.requested_at.toISOString(),
      completedAt: row.completed_at === null ? null : row.completed_at.toISOString(),
      detail: row.detail,
    };
  }

  /** The receipt, vault by vault. What the member is shown. */
  async receipt(
    requestId: string,
  ): Promise<{ service: string; outcome: string; purged: number | null; detail: string | null }[]> {
    const { rows } = await this.pool.query<{
      target_service: string;
      outcome: string;
      purged_count: number | null;
      detail: string | null;
    }>(
      `SELECT target_service, outcome, purged_count, detail
         FROM deletion_audit_logs WHERE request_id = $1 ORDER BY recorded_at`,
      [requestId],
    );
    return rows.map((r) => ({
      service: r.target_service,
      outcome: r.outcome,
      purged: r.purged_count,
      detail: r.detail,
    }));
  }

  async recordExport(pseudoId: number, byteCount: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO export_requests (pseudo_id, state, delivered_at, byte_count)
       VALUES ($1, 'delivered', now(), $2)`,
      [pseudoId, byteCount],
    );
  }

  async close_(): Promise<void> {
    await this.pool.end();
  }
}
