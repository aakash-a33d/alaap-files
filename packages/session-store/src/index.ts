/**
 * packages/session-store
 *
 * Opaque session tokens in Redis (backend-requirements §5). One implementation of the
 * key derivation and the record shape, because auth-service WRITES sessions and the
 * gateway READS them — and if those two disagree by a single field name, every login
 * succeeds and every subsequent request 401s.
 *
 * Before this package the shape existed in three places: the gateway's own store, the
 * dev session minter, and about to be auth-service. Three copies of a contract that
 * has to match exactly.
 *
 * Not JWTs. Zero-trust operations require instant revocation — log out everywhere,
 * staff exit, kill on suspicious login — and a stateless token cannot be revoked
 * without a server-side blocklist, at which point it is a slower opaque session with
 * extra failure modes.
 *
 * REDIS LOSS LOGS EVERYONE OUT. That is correct behaviour and must not be "fixed"
 * with a fallback that weakens revocation.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { SessionActorRole } from '@alaap/shared-types';

/** The minimal Redis surface this package needs. Structural, so it is testable. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
}

/**
 * A live session.
 *
 * Note what is absent: no legal name, no mobile number, no plan tier, no payment
 * detail. A session identifies an actor and nothing about the person behind it, so a
 * dump of the session keyspace yields pseudonymous ids and role labels.
 */
export interface SessionRecord {
  sessionId: string;
  accountId: string;
  /** The join key across vaults. Never a legal identity. */
  pseudoId: number;
  actorRole: SessionActorRole;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  /** Step-up assertions expire independently of, and sooner than, the session. */
  steppedUpAt?: string;
  steppedUpScope?: string;
  deviceId?: string;
}

const KEY_PREFIX = 'session:';

/**
 * Fifteen minutes. Long enough to complete a sensitive flow, short enough that a
 * session stolen afterwards is unlikely to still carry the assertion.
 */
export const STEP_UP_LIFETIME_MS = 15 * 60_000;

/**
 * Session lifetimes by role.
 *
 * Therapist and staff sessions are shorter than user sessions (§5): they carry more
 * authority over other people's records, and a stolen staff session is worth more to
 * an attacker than a stolen member session.
 */
export const SESSION_POLICY: Readonly<
  Record<SessionActorRole, { slidingMinutes: number; absoluteHours: number }>
> = {
  user: { slidingMinutes: 30, absoluteHours: 720 },
  partner: { slidingMinutes: 30, absoluteHours: 168 },
  therapist: { slidingMinutes: 20, absoluteHours: 12 },
  moderator: { slidingMinutes: 20, absoluteHours: 12 },
  safety_reviewer: { slidingMinutes: 15, absoluteHours: 12 },
  admin: { slidingMinutes: 15, absoluteHours: 8 },
};

/** Redis is keyed by the token's hash, so a keyspace dump yields nothing presentable. */
export function sessionKey(token: string): string {
  return KEY_PREFIX + createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Opaque, high-entropy, and never stored. 256 bits. */
export function mintToken(): string {
  return `alaap_${randomBytes(32).toString('base64url')}`;
}

/** Constant-time comparison. A length mismatch short-circuits, leaking only length. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Is there a live step-up assertion covering this scope?
 *
 * A separate question from whether the session is valid, because step-up expires
 * sooner. An assertion with no scope covers nothing — that is what stops a step-up
 * taken to change a payment method from unlocking break-glass.
 */
export function hasStepUp(
  record: SessionRecord,
  scope: string,
  now: Date = new Date(),
): boolean {
  if (record.steppedUpAt === undefined || record.steppedUpScope === undefined) return false;
  const at = Date.parse(record.steppedUpAt);
  if (!Number.isFinite(at)) return false;
  if (now.getTime() - at > STEP_UP_LIFETIME_MS) return false;
  return record.steppedUpScope === scope;
}

export interface SessionLookup {
  record: SessionRecord;
  /** Seconds remaining on the sliding window, after any extension. */
  ttlSeconds: number;
}

export interface MintRequest {
  accountId: string;
  pseudoId: number;
  actorRole: SessionActorRole;
  deviceId?: string;
  /** Overrides the role policy. Only shorten, never lengthen. */
  slidingMinutes?: number;
}

export interface MintResult {
  token: string;
  record: SessionRecord;
}

export class SessionStore {
  private readonly redis: RedisLike;
  private readonly maxAbsoluteHours: number;

  constructor(redis: RedisLike, maxAbsoluteHours = 720) {
    this.redis = redis;
    this.maxAbsoluteHours = maxAbsoluteHours;
  }

  /**
   * Create a session. Written by auth-service after a successful authentication.
   *
   * The returned token is the only time it exists in plaintext anywhere.
   */
  async mint(req: MintRequest, now: Date = new Date()): Promise<MintResult> {
    const policy = SESSION_POLICY[req.actorRole];
    const sliding = Math.min(req.slidingMinutes ?? policy.slidingMinutes, policy.slidingMinutes);

    const t = now.getTime();
    const absolute = t + policy.absoluteHours * 3_600_000;
    const expires = Math.min(t + sliding * 60_000, absolute);

    const record: SessionRecord = {
      sessionId: crypto.randomUUID(),
      accountId: req.accountId,
      pseudoId: req.pseudoId,
      actorRole: req.actorRole,
      createdAt: new Date(t).toISOString(),
      lastActiveAt: new Date(t).toISOString(),
      expiresAt: new Date(expires).toISOString(),
      absoluteExpiresAt: new Date(absolute).toISOString(),
      ...(req.deviceId !== undefined ? { deviceId: req.deviceId } : {}),
    };

    const token = mintToken();
    const ttl = Math.max(1, Math.ceil((expires - t) / 1000));
    await this.redis.set(sessionKey(token), JSON.stringify(record), 'EX', ttl);

    return { token, record };
  }

  /**
   * Resolve a token to a live session, applying the sliding window.
   *
   * Returns undefined for absent, malformed, revoked and expired sessions alike. The
   * caller cannot distinguish them, and should not be able to.
   */
  async resolve(token: string, now: Date = new Date()): Promise<SessionLookup | undefined> {
    const key = sessionKey(token);
    const raw = await this.redis.get(key);
    if (raw === null) return undefined;

    let record: SessionRecord;
    try {
      record = JSON.parse(raw) as SessionRecord;
    } catch {
      await this.redis.del(key);
      return undefined;
    }

    const absolute = Date.parse(record.absoluteExpiresAt);
    const sliding = Date.parse(record.expiresAt);
    const created = Date.parse(record.createdAt);
    if (!Number.isFinite(absolute) || !Number.isFinite(sliding) || !Number.isFinite(created)) {
      await this.redis.del(key);
      return undefined;
    }

    const t = now.getTime();
    if (t >= absolute || t >= sliding) {
      await this.redis.del(key);
      return undefined;
    }

    // A record claiming a longer absolute lifetime than this deployment permits is
    // dropped rather than trusted — a guard against a stale session outliving a
    // policy change, or a tampered one.
    if (absolute - created > this.maxAbsoluteHours * 3_600_000) {
      await this.redis.del(key);
      return undefined;
    }

    const window = sliding - created > 0 ? sliding - created : 30 * 60_000;
    const extended = Math.min(t + window, absolute);
    const updated: SessionRecord = {
      ...record,
      lastActiveAt: new Date(t).toISOString(),
      expiresAt: new Date(extended).toISOString(),
    };

    const ttlSeconds = Math.max(1, Math.ceil((extended - t) / 1000));
    await this.redis.set(key, JSON.stringify(updated), 'EX', ttlSeconds);

    return { record: updated, ttlSeconds };
  }

  /** Revoke one session. Idempotent. */
  async revoke(token: string): Promise<void> {
    await this.redis.del(sessionKey(token));
  }

  /**
   * Log out everywhere.
   *
   * Scans the keyspace because Redis is keyed by token hash, which cannot be derived
   * from an account id. Acceptable: this runs on an explicit user action or a security
   * event, never on the request path. If it ever needs to be fast, the answer is a
   * `sessions:by-account:<id>` index written at mint time — not a lookup table
   * mapping accounts to tokens, which would defeat the hashing.
   */
  async revokeAllForAccount(accountId: string): Promise<number> {
    return this.revokeMatching((record) => record.accountId === accountId);
  }

  /**
   * End every session on one device.
   *
   * Scoped to the account as well as the device. A device id is a UUID and cannot
   * realistically collide, but the account predicate is what makes this incapable of
   * ending a stranger's session even if a caller supplied somebody else's id — and
   * that guarantee should not rest on UUIDs being unguessable.
   */
  async revokeAllForDevice(accountId: string, deviceId: string): Promise<number> {
    return this.revokeMatching(
      (record) => record.accountId === accountId && record.deviceId === deviceId,
    );
  }

  /**
   * End the account's sessions that carry no device id.
   *
   * These exist for two reasons: sessions minted before devices were recorded, and
   * clients that send no device key. Either way they are invisible in the member's
   * device list, so "sign out everywhere else" would silently leave them running —
   * and a security control that quietly does less than it says is worse than one that
   * is absent, because somebody relies on it.
   */
  async revokeDevicelessForAccount(accountId: string): Promise<number> {
    return this.revokeMatching(
      (record) => record.accountId === accountId && record.deviceId === undefined,
    );
  }

  /**
   * The account's live sessions.
   *
   * Same keyspace scan as the revoke paths, and the same justification: this runs
   * when a member opens their device list, not on the request path.
   */
  async listForAccount(accountId: string): Promise<SessionRecord[]> {
    const out: SessionRecord[] = [];
    await this.eachSession((record) => {
      if (record.accountId === accountId) out.push(record);
      return false;
    });
    return out;
  }

  /** Shared scan. Deletes any record that will not parse, wherever it is found. */
  private async eachSession(
    visit: (record: SessionRecord, key: string) => boolean,
  ): Promise<number> {
    const keys = await this.redis.keys(`${KEY_PREFIX}*`);
    let acted = 0;
    for (const key of keys) {
      const raw = await this.redis.get(key);
      if (raw === null) continue;
      let record: SessionRecord;
      try {
        record = JSON.parse(raw) as SessionRecord;
      } catch {
        await this.redis.del(key);
        continue;
      }
      if (visit(record, key)) {
        await this.redis.del(key);
        acted += 1;
      }
    }
    return acted;
  }

  private async revokeMatching(
    predicate: (record: SessionRecord) => boolean,
  ): Promise<number> {
    return this.eachSession((record) => predicate(record));
  }
}
