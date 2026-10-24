/**
 * Trusted device repository. `core`, auth-service's own tables.
 *
 * Holds nothing that identifies a device beyond an account-scoped HMAC and a coarse
 * label from a closed list. No user-agent, no IP, no fingerprint — see
 * domain/devices.ts for why that matters more here than on an ordinary service.
 */

import type { Pool } from 'pg';

export interface TrustedDevice {
  id: string;
  label: string;
  firstSeenAt: string;
  lastSeenAt: string;
  revokedAt: string | undefined;
}

interface Row {
  id: string;
  label: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
  revoked_at: Date | null;
}

function toDevice(row: Row, fallbackLabel: string): TrustedDevice {
  return {
    id: row.id,
    label: row.label ?? fallbackLabel,
    firstSeenAt: row.first_seen_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    revokedAt: row.revoked_at === null ? undefined : row.revoked_at.toISOString(),
  };
}

const COLUMNS = 'id, label, first_seen_at, last_seen_at, revoked_at';

export interface SeenResult {
  device: TrustedDevice;
  /** True the first time this device is seen on this account. Drives the audit event. */
  isNew: boolean;
}

export class DeviceRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Record that this device just signed in, creating it if it is new.
   *
   * One statement, because two sign-ins from the same device can race and a
   * SELECT-then-INSERT would lose that race exactly when somebody is signing in on
   * two tabs at once.
   *
   * A previously revoked device is REACTIVATED here rather than refused. That is
   * deliberate, and it is the honest consequence of a device not being a credential:
   * whoever is signing in has just proved themselves with a passkey, an OTP or a
   * recovery code, and there is no basis on which to refuse them because of which
   * browser they used. Revoking a device ends its sessions; it cannot keep out
   * somebody who can still authenticate. The audit trail keeps both events, so the
   * pattern "revoked, then back an hour later" stays visible.
   */
  async seen(params: {
    accountId: string;
    deviceHash: Buffer;
    defaultLabel: string;
  }): Promise<SeenResult> {
    const { rows } = await this.pool.query<Row & { inserted: boolean }>(
      `INSERT INTO trusted_devices (account_id, device_hash, label)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_id, device_hash) DO UPDATE
         SET last_seen_at = now(),
             revoked_at   = NULL
       RETURNING ${COLUMNS}, (xmax = 0) AS inserted`,
      [params.accountId, params.deviceHash, params.defaultLabel],
    );
    const row = rows[0]!;
    return { device: toDevice(row, params.defaultLabel), isNew: row.inserted };
  }

  /**
   * Every device on the account, newest activity first.
   *
   * Revoked devices are excluded. A member looking at this list is asking "where am I
   * signed in", and something they already signed out is not an answer to that — it
   * is clutter that makes the row that matters harder to see.
   */
  async list(accountId: string, fallbackLabel: string): Promise<TrustedDevice[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM trusted_devices
        WHERE account_id = $1 AND revoked_at IS NULL
        ORDER BY last_seen_at DESC`,
      [accountId],
    );
    return rows.map((r) => toDevice(r, fallbackLabel));
  }

  /**
   * Revoke one device.
   *
   * Scoped to the account in the WHERE clause, not merely checked beforehand. The
   * device id arrives from the caller, and the only thing standing between that and
   * signing out a stranger's phone is this predicate.
   *
   * Returns false for an unknown id, an id belonging to somebody else, and an already
   * revoked device alike — the caller cannot tell them apart, and should not be able
   * to, since that difference would confirm whether a given device id exists.
   */
  async revoke(accountId: string, deviceId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE trusted_devices SET revoked_at = now()
        WHERE account_id = $1 AND id = $2 AND revoked_at IS NULL`,
      [accountId, deviceId],
    );
    return (rowCount ?? 0) > 0;
  }

  /** Revoke everything except one device. Returns the ids actually revoked. */
  async revokeOthers(accountId: string, keepDeviceId: string | undefined): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      `UPDATE trusted_devices SET revoked_at = now()
        WHERE account_id = $1 AND revoked_at IS NULL
          AND ($2::uuid IS NULL OR id <> $2::uuid)
        RETURNING id`,
      [accountId, keepDeviceId ?? null],
    );
    return rows.map((r) => r.id);
  }

  async rename(accountId: string, deviceId: string, label: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE trusted_devices SET label = $3
        WHERE account_id = $1 AND id = $2 AND revoked_at IS NULL`,
      [accountId, deviceId, label],
    );
    return (rowCount ?? 0) > 0;
  }
}
