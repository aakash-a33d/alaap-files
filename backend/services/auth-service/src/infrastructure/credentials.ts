/**
 * Passkey credential repository. `core`.
 *
 * Stores public keys, which are public — the private key never leaves the
 * authenticator, which is the entire security argument for passkeys over passwords.
 * A dump of this table lets an attacker verify signatures, never produce them.
 */

import { Pool } from 'pg';

export interface StoredCredential {
  id: string;
  accountId: string;
  credentialId: Buffer;
  publicKey: Buffer;
  signCount: number;
  transports: string[];
  aaguid: string | null;
  backupEligible: boolean;
  backupState: boolean;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface Row {
  id: string;
  account_id: string;
  credential_id: Buffer;
  public_key: Buffer;
  sign_count: string;
  transports: string[];
  aaguid: string | null;
  backup_eligible: boolean;
  backup_state: boolean;
  label: string | null;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

function toCredential(row: Row): StoredCredential {
  return {
    id: row.id,
    accountId: row.account_id,
    credentialId: row.credential_id,
    publicKey: row.public_key,
    signCount: Number(row.sign_count),
    transports: row.transports,
    aaguid: row.aaguid,
    backupEligible: row.backup_eligible,
    backupState: row.backup_state,
    label: row.label,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
  };
}

const COLUMNS = `id, account_id, credential_id, public_key, sign_count, transports,
                 aaguid, backup_eligible, backup_state, label, created_at,
                 last_used_at, revoked_at`;

export class CredentialRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async listForAccount(accountId: string, includeRevoked = false): Promise<StoredCredential[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM passkey_credentials
       WHERE account_id = $1 ${includeRevoked ? '' : 'AND revoked_at IS NULL'}
       ORDER BY created_at`,
      [accountId],
    );
    return rows.map(toCredential);
  }

  /**
   * Find by credential id, for an assertion.
   *
   * Returns revoked credentials too, so the caller can distinguish "unknown
   * credential" from "revoked credential" in its own logs — while answering the
   * caller identically either way.
   */
  async findByCredentialId(credentialId: Buffer): Promise<StoredCredential | undefined> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM passkey_credentials WHERE credential_id = $1`,
      [credentialId],
    );
    const row = rows[0];
    return row === undefined ? undefined : toCredential(row);
  }

  async create(params: {
    accountId: string;
    credentialId: Buffer;
    publicKey: Buffer;
    signCount: number;
    transports: string[];
    aaguid: string | null;
    backupEligible: boolean;
    backupState: boolean;
    label: string | null;
  }): Promise<StoredCredential> {
    const { rows } = await this.pool.query<Row>(
      `INSERT INTO passkey_credentials
         (account_id, credential_id, public_key, sign_count, transports,
          aaguid, backup_eligible, backup_state, label)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${COLUMNS}`,
      [
        params.accountId,
        params.credentialId,
        params.publicKey,
        params.signCount,
        params.transports,
        params.aaguid,
        params.backupEligible,
        params.backupState,
        params.label,
      ],
    );
    return toCredential(rows[0]!);
  }

  /**
   * Advance the counter after a successful assertion.
   *
   * `GREATEST` rather than a plain assignment: an authenticator that reports zero
   * always — every iCloud Keychain and Google Password Manager credential does,
   * because a credential synced across devices cannot keep one counter — must not
   * reset a counter that was previously meaningful.
   */
  async recordUse(id: string, signCount: number): Promise<void> {
    await this.pool.query(
      `UPDATE passkey_credentials
       SET sign_count = GREATEST(sign_count, $2), last_used_at = now()
       WHERE id = $1`,
      [id, signCount],
    );
  }

  /** Revoke rather than delete, so the device stays visible in an incident review. */
  async revoke(id: string, accountId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE passkey_credentials SET revoked_at = now()
       WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL`,
      [id, accountId],
    );
    return (rowCount ?? 0) > 0;
  }
}
