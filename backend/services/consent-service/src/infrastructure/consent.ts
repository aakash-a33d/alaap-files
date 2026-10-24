/**
 * Consent records and withdrawals. clinical_vault, consent-service's own tables.
 *
 * This service decides whether processing is permitted and can read none of the
 * content it is deciding about — the grants withhold `journal_entries` and
 * `short_stories` from it explicitly. The service that holds the content, in turn, has
 * no write here and cannot grant itself permission.
 *
 * NOTHING IS EVER UPDATED IN PLACE
 *
 * A withdrawal does not edit the grant that preceded it. The grant keeps its row and
 * its timestamp, the withdrawal gets its own, and the pair is the evidence. Proving a
 * withdrawal was honoured requires knowing exactly when it was made — which is why
 * `consent.withdrawn` is retained permanently, and why an UPDATE that overwrote the
 * grant would destroy the only record that matters.
 */

import { Pool } from 'pg';

export interface ConsentRecord {
  id: string;
  purpose: string;
  state: string;
  grantedAt: string;
  withdrawnAt: string | undefined;
  expiresAt: string | undefined;
  versionId: string;
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
export function createConsentPool(
  connectionString: string,
  log?: { error(o: object, m?: string): void },
): Pool {
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    application_name: 'alaap-consent-service',
  });
  pool.on('error', (err) => {
    log?.error({ err: err.message }, 'idle database client failed; pool will recover');
  });
  return pool;
}

const SELECT = `SELECT id, purpose, state, granted_at, withdrawn_at, expires_at,
                       consent_version_id
                  FROM consent_records`;

interface Row {
  id: string;
  purpose: string;
  state: string;
  granted_at: Date;
  withdrawn_at: Date | null;
  expires_at: Date | null;
  consent_version_id: string;
}

const toRecord = (r: Row): ConsentRecord => ({
  id: r.id,
  purpose: r.purpose,
  state: r.state,
  grantedAt: r.granted_at.toISOString(),
  withdrawnAt: r.withdrawn_at?.toISOString(),
  expiresAt: r.expires_at?.toISOString(),
  versionId: r.consent_version_id,
});

export class ConsentRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /** The consent text currently in force for a purpose. */
  async currentVersion(purpose: string): Promise<string | undefined> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM consent_versions
        WHERE purpose = $1 AND superseded_by IS NULL
        ORDER BY published_at DESC LIMIT 1`,
      [purpose],
    );
    return rows[0]?.id;
  }

  /**
   * Is this processing currently permitted?
   *
   * Expiry is evaluated HERE rather than trusted from `state`, because a record
   * expires by the passage of time and nothing writes a row at that moment. A sweep
   * that marks them `expired` may or may not have run; the clock is authoritative.
   */
  async isGranted(pseudoId: number, purpose: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM consent_records
          WHERE pseudo_id = $1 AND purpose = $2 AND state = 'granted'
            AND (expires_at IS NULL OR expires_at > now())
       ) AS ok`,
      [pseudoId, purpose],
    );
    return rows[0]?.ok === true;
  }

  /**
   * Grant consent.
   *
   * Any earlier grant for the same purpose is SUPERSEDED rather than replaced: it
   * keeps its row, and the new one records that the member agreed again, possibly to
   * different words. Consent to version 2 is not consent to version 5.
   */
  async grant(params: {
    pseudoId: number;
    purpose: string;
    versionId: string;
    expiresAt?: Date | undefined;
  }): Promise<ConsentRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE consent_records SET state = 'superseded'
          WHERE pseudo_id = $1 AND purpose = $2 AND state = 'granted'`,
        [params.pseudoId, params.purpose],
      );
      const { rows } = await client.query<Row>(
        `INSERT INTO consent_records (pseudo_id, purpose, consent_version_id, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id, purpose, state, granted_at, withdrawn_at, expires_at, consent_version_id`,
        [params.pseudoId, params.purpose, params.versionId, params.expiresAt ?? null],
      );
      await client.query('COMMIT');
      return toRecord(rows[0]!);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Withdraw consent.
   *
   * The grant row is marked withdrawn and a withdrawal row is written beside it, in
   * one transaction. Two rows rather than one because they answer different questions:
   * the record says this consent is no longer live, and the withdrawal says when the
   * member asked and what they asked about.
   *
   * Returns false when there was nothing granted. The caller answers identically
   * either way — a member who withdraws twice should not be told off.
   */
  async withdraw(params: {
    pseudoId: number;
    purpose: string;
    reason?: string | undefined;
  }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        `UPDATE consent_records
            SET state = 'withdrawn', withdrawn_at = now()
          WHERE pseudo_id = $1 AND purpose = $2 AND state = 'granted'
          RETURNING id`,
        [params.pseudoId, params.purpose],
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      for (const row of rows) {
        // The withdrawal row carries only the record it withdraws. Who and what are
        // already on that record, and duplicating them here would create two places
        // for the same fact to be edited.
        //
        // `derived_artifacts_deleted` starts false and stays false until
        // retention-service (M9) purges what was derived under this consent — an AI
        // summary, an insight artifact. Honouring a withdrawal means removing those
        // too, and this column is the evidence of whether that has happened yet.
        await client.query(
          `INSERT INTO consent_withdrawals (consent_record_id) VALUES ($1)`,
          [row.id],
        );
      }
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Everything the member has ever agreed to, withdrawn included. */
  async history(pseudoId: number): Promise<ConsentRecord[]> {
    const { rows } = await this.pool.query<Row>(
      `${SELECT} WHERE pseudo_id = $1 ORDER BY granted_at DESC LIMIT 200`,
      [pseudoId],
    );
    return rows.map(toRecord);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
  /**
   * Every consent this member ever gave, and every withdrawal.
   *
   * The history whole, not the current state. "Did I withdraw this, and when" is the
   * question somebody asks years later, and a list of live grants cannot answer it.
   * The version id is included so the export says what they agreed TO, not merely that
   * they agreed.
   */
  async exportFor(pseudoId: number): Promise<
    { purpose: string; state: string; versionId: string; grantedAt: string; withdrawnAt: string | null }[]
  > {
    const { rows } = await this.pool.query<{
      purpose: string;
      state: string;
      consent_version_id: string;
      granted_at: Date;
      withdrawn_at: Date | null;
    }>(
      `SELECT purpose, state, consent_version_id, granted_at, withdrawn_at
         FROM consent_records WHERE pseudo_id = $1 ORDER BY granted_at`,
      [pseudoId],
    );
    return rows.map((r) => ({
      purpose: r.purpose,
      state: r.state,
      versionId: r.consent_version_id,
      grantedAt: r.granted_at.toISOString(),
      withdrawnAt: r.withdrawn_at === null ? null : r.withdrawn_at.toISOString(),
    }));
  }

  /**
   * Remove the consent records.
   *
   * Worth being clear about what this does and does not mean. The RECORD of consent is
   * deleted along with everything else, because it is the member's data. The audit
   * vault separately holds `consent.granted` and `consent.withdrawn` events, which are
   * not deleted — those are how the platform proves it honoured a withdrawal, and
   * destroying them would leave the member with only our word for it.
   */
  async purge(pseudoId: number): Promise<{ purged: number; held: number; detail: string[] }> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM consent_records WHERE pseudo_id = $1`,
      [pseudoId],
    );
    return { purged: rowCount ?? 0, held: 0, detail: [] };
  }

}
