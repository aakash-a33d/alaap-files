/**
 * Account repository. `core`, which auth-service alone holds credentials to.
 *
 * `core` is deliberately outside the vault access matrix: it holds credentials —
 * accounts, passkeys, recovery codes, sessions, login events — rather than one of the
 * five protected data domains, and including it would dilute what that matrix exists
 * to prevent.
 *
 * This table knows neither the real person (identity vault) nor the public persona
 * (community vault). It knows that a credential exists.
 */

import { Pool, type PoolClient } from 'pg';

import { generatePseudoId, type RecoveryCodeBundle } from '../domain/identifiers.ts';

export interface Account {
  id: string;
  pseudoId: number;
  status: 'active' | 'suspended' | 'locked' | 'closed';
  preferredLanguage: string;
  ageConfirmed: boolean;
  privacyMode: 'standard' | 'maximum';
  createdAt: string;
}

interface AccountRow {
  id: string;
  pseudo_id: string;
  status: Account['status'];
  preferred_language: string;
  age_confirmed: boolean;
  privacy_mode: Account['privacyMode'];
  created_at: Date;
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    pseudoId: Number(row.pseudo_id),
    status: row.status,
    preferredLanguage: row.preferred_language,
    ageConfirmed: row.age_confirmed,
    privacyMode: row.privacy_mode,
    createdAt: row.created_at.toISOString(),
  };
}

const SELECT = `
  SELECT id, pseudo_id, status, preferred_language, age_confirmed, privacy_mode, created_at
  FROM auth_accounts`;

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
export function createCorePool(
  connectionString: string,
  log?: { error(o: object, m?: string): void },
): Pool {
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    application_name: 'alaap-auth-service',
  });
  pool.on('error', (err) => {
    log?.error({ err: err.message }, 'idle database client failed; pool will recover');
  });
  return pool;
}

export class AccountRepository {
  private readonly pool: Pool;

  // Takes a pool rather than a connection string so CredentialRepository shares it.
  // Two pools to the same database would double the connection count for no reason,
  // and `core` is a small cluster with a modest max_connections.
  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Resolve an account from the gateway's SIGNED pseudo_id.
   *
   * This is how a request gets an account id. The account id must never arrive in a
   * request body: the gateway signs `x-alaap-pseudo-id`, so that value is trustworthy,
   * while anything in the body is whatever the caller typed. Taking it from the body
   * would let any authenticated member enrol a passkey against another member's
   * account, which is account takeover with extra steps.
   */
  async findByPseudoId(pseudoId: number): Promise<Account | undefined> {
    const { rows } = await this.pool.query<AccountRow>(`${SELECT} WHERE pseudo_id = $1`, [
      pseudoId,
    ]);
    const row = rows[0];
    return row === undefined ? undefined : toAccount(row);
  }

  /** Resolve an account from a passkey assertion's user handle. */
  async findById(id: string): Promise<Account | undefined> {
    const { rows } = await this.pool.query<AccountRow>(`${SELECT} WHERE id = $1`, [id]);
    const row = rows[0];
    return row === undefined ? undefined : toAccount(row);
  }

  async findByMobileHash(hash: Buffer): Promise<Account | undefined> {
    const { rows } = await this.pool.query<AccountRow>(
      `${SELECT} WHERE mobile_lookup_hash = $1`,
      [hash],
    );
    const row = rows[0];
    return row === undefined ? undefined : toAccount(row);
  }

  /**
   * Create an account, retrying on a pseudo_id collision.
   *
   * pseudo_id is random rather than sequential (see domain/identifiers.ts), so a
   * collision is possible and the unique constraint is the arbiter. Retrying on
   * 23505 is correct; pre-checking would be a race.
   */
  async create(params: {
    mobileHash: Buffer;
    preferredLanguage: string;
    ageConfirmed: boolean;
    country: string | undefined;
    recoveryCodes: RecoveryCodeBundle;
  }): Promise<Account> {
    const client = await this.pool.connect();
    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const pseudoId = generatePseudoId();
        try {
          await client.query('BEGIN');
          const { rows } = await client.query<AccountRow>(
            `INSERT INTO auth_accounts
               (pseudo_id, mobile_lookup_hash, preferred_language, age_confirmed, country)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, pseudo_id, status, preferred_language, age_confirmed,
                       privacy_mode, created_at`,
            [
              pseudoId,
              params.mobileHash,
              params.preferredLanguage,
              params.ageConfirmed,
              params.country ?? null,
            ],
          );
          const account = toAccount(rows[0]!);
          await this.insertRecoveryCodes(client, account.id, params.recoveryCodes);
          await client.query('COMMIT');
          return account;
        } catch (err) {
          await client.query('ROLLBACK');
          const code = (err as { code?: string; constraint?: string }).code;
          const constraint = (err as { constraint?: string }).constraint ?? '';
          // A pseudo_id collision is retryable. A duplicate mobile hash is not —
          // it means the account already exists, and the caller must be told so
          // rather than having a second one created.
          if (code === '23505' && constraint.includes('pseudo_id') && attempt < 7) continue;
          throw err;
        }
      }
      throw new Error('could not allocate a unique pseudo_id after 8 attempts');
    } finally {
      client.release();
    }
  }

  private async insertRecoveryCodes(
    client: PoolClient,
    accountId: string,
    bundle: RecoveryCodeBundle,
  ): Promise<void> {
    for (const hash of bundle.hashes) {
      await client.query(
        `INSERT INTO recovery_codes (account_id, code_hash, bundle_generation)
         VALUES ($1, $2, $3)`,
        [accountId, hash, bundle.generation],
      );
    }
  }

  // ------------------------------------------------------------ recovery ---

  /**
   * Unused codes for an account, so the caller can compare in constant time.
   *
   * Returning candidates rather than matching in SQL is deliberate: the hash is
   * deterministic, and `WHERE code_hash = $1` would compare a caller-supplied value
   * inside the database, where the comparison is not constant-time and the query plan
   * can leak timing. Ten rows is a trivial fetch.
   */
  async listUnusedRecoveryCodes(
    accountId: string,
  ): Promise<Array<{ id: string; codeHash: Buffer }>> {
    const { rows } = await this.pool.query<{ id: string; code_hash: Buffer }>(
      `SELECT id, code_hash FROM recovery_codes
       WHERE account_id = $1 AND consumed_at IS NULL`,
      [accountId],
    );
    return rows.map((r) => ({ id: r.id, codeHash: r.code_hash }));
  }

  /**
   * Spend a code. Atomic, so two concurrent attempts cannot both succeed with the
   * same one — the `consumed_at IS NULL` predicate is the lock.
   */
  async consumeRecoveryCode(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE recovery_codes SET consumed_at = now()
       WHERE id = $1 AND consumed_at IS NULL`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }

  async currentBundleGeneration(accountId: string): Promise<number> {
    const { rows } = await this.pool.query<{ generation: number | null }>(
      'SELECT max(bundle_generation) AS generation FROM recovery_codes WHERE account_id = $1',
      [accountId],
    );
    return rows[0]?.generation ?? 0;
  }

  /**
   * Replace the bundle.
   *
   * Deletes the old codes rather than marking them consumed. A member who regenerates
   * has been told the previous sheet stops working, and leaving spent-but-unused rows
   * behind would make "how many codes do I have left" answer wrongly.
   */
  async replaceRecoveryCodes(accountId: string, bundle: RecoveryCodeBundle): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM recovery_codes WHERE account_id = $1', [accountId]);
      await this.insertRecoveryCodes(client, accountId, bundle);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Record a login attempt.
   *
   * This is a SECURITY signal, not the audit trail — the immutable record lives in
   * the audit vault on another instance. This table exists for rate limiting and
   * suspicious-login detection and is retained on a short cycle.
   *
   * The IP arrives already truncated to a /24 or /48 prefix (§12N). The caller
   * truncates; this repository refuses to be the place where a full address is
   * accidentally persisted, so it takes a prefix and never an address.
   */
  async recordLoginEvent(params: {
    accountId: string | undefined;
    method: 'passkey' | 'otp' | 'recovery_code';
    result: 'success' | 'failure' | 'locked_out' | 'challenged';
    ipPrefix: string | undefined;
    userAgentHash: Buffer | undefined;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO login_events (account_id, method, result, ip_prefix, user_agent_hash)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        params.accountId ?? null,
        params.method,
        params.result,
        params.ipPrefix ?? null,
        params.userAgentHash ?? null,
      ],
    );
  }

  /** Durable session record, for "log out everywhere" and suspicious-login review. */
  async recordSession(params: {
    accountId: string;
    sessionId: string;
    tokenHash: Buffer;
    actorRole: string;
    expiresAt: string;
    absoluteExpiresAt: string;
    deviceId?: string | undefined;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions
         (id, account_id, token_hash, actor_role, expires_at, absolute_expires_at, device_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.sessionId,
        params.accountId,
        params.tokenHash,
        params.actorRole,
        params.expiresAt,
        params.absoluteExpiresAt,
        params.deviceId ?? null,
      ],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
  /**
   * The account's own shape. No credentials, ever.
   *
   * Recovery code hashes, passkey public keys and the mobile blind index are omitted
   * deliberately: they are about the member but are not theirs to take, and an export
   * file containing them is a credential store sitting in somebody's downloads folder.
   */
  async exportFor(pseudoId: number): Promise<
    { createdAt: string; status: string; preferredLanguage: string; ageConfirmed: boolean } | undefined
  > {
    const { rows } = await this.pool.query<{
      created_at: Date;
      status: string;
      preferred_language: string;
      age_confirmed: boolean;
    }>(
      `SELECT created_at, status, preferred_language, age_confirmed
         FROM auth_accounts WHERE pseudo_id = $1`,
      [pseudoId],
    );
    const row = rows[0];
    return row === undefined
      ? undefined
      : {
          createdAt: row.created_at.toISOString(),
          status: row.status,
          preferredLanguage: row.preferred_language,
          ageConfirmed: row.age_confirmed,
        };
  }

  /**
   * Destroy the account and everything that authenticates it.
   *
   * Order matters: children before the account row they reference. Sessions go first
   * so that the moment this transaction commits there is no live credential for an
   * account that no longer exists.
   *
   * `login_events` goes too. It is a record of when somebody signed in, which is a
   * behavioural trail about a person, and the audit vault already holds what the
   * platform needs to prove.
   */
  async purge(
    pseudoId: number,
    /**
     * Ends the live sessions before the rows go.
     *
     * Deleting `core.sessions` removes the RECORD of a session; the session itself
     * lives in Redis under a hash of its token, and the gateway resolves it from
     * there. Without this the member's cookie kept working against an account that no
     * longer existed — which the acceptance suite caught by asking "who am I?" after
     * a deletion and getting an answer.
     */
    endSessions?: (accountId: string) => Promise<unknown>,
  ): Promise<{ purged: number; held: number; detail: string[] }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM auth_accounts WHERE pseudo_id = $1`,
        [pseudoId],
      );
      const account = rows[0];
      if (account === undefined) {
        await client.query('COMMIT');
        return { purged: 0, held: 0, detail: [] };
      }

      // Before anything is deleted. A session that outlives its account is a live
      // credential for a member who asked to stop existing here.
      if (endSessions !== undefined) await endSessions(account.id);

      let purged = 0;
      for (const table of [
        'sessions',
        'trusted_devices',
        'recovery_codes',
        'passkey_credentials',
        'login_events',
      ]) {
        const r = await client.query(`DELETE FROM ${table} WHERE account_id = $1`, [account.id]);
        purged += r.rowCount ?? 0;
      }

      const acc = await client.query(`DELETE FROM auth_accounts WHERE id = $1`, [account.id]);
      purged += acc.rowCount ?? 0;

      await client.query('COMMIT');
      return { purged, held: 0, detail: [] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

}
