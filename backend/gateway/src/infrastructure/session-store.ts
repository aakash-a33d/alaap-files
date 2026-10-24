/**
 * Session store.
 *
 * Opaque tokens in Redis, not stateless JWTs (backend-requirements §5). Zero-trust
 * operations require instant revocation — remote logout, staff exit, session kill on
 * suspicious login — and a JWT cannot be revoked without a server-side blocklist, at
 * which point it is a slower opaque session with extra failure modes.
 *
 * The token itself is never stored. Redis is keyed by SHA-256 of the token, so a
 * dump of the keyspace does not yield anything a caller could present.
 *
 * Redis loss logs everyone out. That is correct and must not be "fixed" with a
 * fallback that weakens revocation.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import type { Redis } from 'ioredis';

import type { SessionRecord } from '../types.ts';

const KEY_PREFIX = 'session:';

/** Session tokens are opaque, high-entropy strings minted by auth-service. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time comparison for any place a caller-supplied value is checked against
 * a stored one. Length mismatch short-circuits, which leaks only length.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface SessionLookup {
  record: SessionRecord;
  /** Seconds remaining before the sliding window closes, after any extension. */
  ttlSeconds: number;
}

export class SessionStore {
  // Explicit fields rather than constructor parameter properties — see the note in
  // types.ts on GatewayError. Strip-only mode cannot erase the annotation without
  // also erasing the assignment.
  private readonly redis: Redis;
  private readonly maxAbsoluteHours: number;

  constructor(redis: Redis, maxAbsoluteHours: number) {
    this.redis = redis;
    this.maxAbsoluteHours = maxAbsoluteHours;
  }

  /**
   * Resolve a token to a live session, applying the sliding window.
   *
   * Returns undefined for absent, malformed, revoked and expired sessions alike.
   * The caller cannot distinguish them, and should not be able to.
   */
  async resolve(token: string, now: Date = new Date()): Promise<SessionLookup | undefined> {
    const key = KEY_PREFIX + hashToken(token);
    const raw = await this.redis.get(key);
    if (raw === null) return undefined;

    let record: SessionRecord;
    try {
      record = JSON.parse(raw) as SessionRecord;
    } catch {
      // A malformed record is a corrupt session, not a valid one. Drop it.
      await this.redis.del(key);
      return undefined;
    }

    const absolute = Date.parse(record.absoluteExpiresAt);
    const sliding = Date.parse(record.expiresAt);
    if (!Number.isFinite(absolute) || !Number.isFinite(sliding)) {
      await this.redis.del(key);
      return undefined;
    }

    const t = now.getTime();
    if (t >= absolute || t >= sliding) {
      await this.redis.del(key);
      return undefined;
    }

    // A session claiming a longer absolute lifetime than this deployment permits is
    // rejected rather than trusted. auth-service sets the real ceiling; this guards
    // against a stale or tampered record outliving a policy change.
    if (absolute - Date.parse(record.createdAt) > this.maxAbsoluteHours * 3_600_000) {
      await this.redis.del(key);
      return undefined;
    }

    // Slide the window forward, never past the absolute expiry.
    const extended = Math.min(t + this.slidingWindowMs(record), absolute);
    const updated: SessionRecord = {
      ...record,
      lastActiveAt: new Date(t).toISOString(),
      expiresAt: new Date(extended).toISOString(),
    };

    const ttlSeconds = Math.max(1, Math.ceil((extended - t) / 1000));
    await this.redis.set(key, JSON.stringify(updated), 'EX', ttlSeconds);

    return { record: updated, ttlSeconds };
  }

  /**
   * End a session, given its token.
   *
   * The gateway is the only component that can do this. The proxy strips `authorization`
   * and `cookie` before forwarding, so the token never reaches auth-service — which
   * means the service that mints sessions cannot revoke the one in front of it. That is
   * the right trade (a downstream service must not be able to replay a member's token
   * against us) and this is its consequence.
   *
   * Deleting the key is the revocation. Nothing is marked or tombstoned: `resolve`
   * treats absent, revoked and expired identically and must keep doing so.
   *
   * Idempotent, and silent about whether anything was there. Signing out twice is not
   * an error, and the difference is not something a caller should be able to observe.
   */
  async revoke(token: string): Promise<void> {
    await this.redis.del(KEY_PREFIX + hashToken(token));
  }

  /**
   * Record that the member proved, just now, that it is them.
   *
   * Scoped and timestamped. The scope is a route prefix and is compared exactly, so an
   * assertion earned for `/api/data-rights` cannot open `/api/break-glass` — the two
   * are not degrees of the same sensitivity, they are different questions, and a member
   * consenting to one has not consented to the other.
   *
   * Writes through the existing record rather than replacing it, and preserves the TTL:
   * stepping up must not extend a session, or a member near their absolute expiry would
   * find that proving their identity silently renewed the thing that was about to end.
   *
   * Does nothing for a session that is already gone. There is no assertion to make about
   * a session that does not exist, and creating the key here would resurrect one.
   */
  async grantStepUp(token: string, scope: string, now: Date = new Date()): Promise<void> {
    const key = KEY_PREFIX + hashToken(token);
    const raw = await this.redis.get(key);
    if (raw === null) return;

    const ttl = await this.redis.ttl(key);
    if (ttl <= 0) return;

    let record: SessionRecord;
    try {
      record = JSON.parse(raw) as SessionRecord;
    } catch {
      await this.redis.del(key);
      return;
    }

    const updated: SessionRecord = {
      ...record,
      steppedUpAt: now.toISOString(),
      steppedUpScope: scope,
    };
    await this.redis.set(key, JSON.stringify(updated), 'EX', ttl);
  }

  /** Original window length, preserved across slides. */
  private slidingWindowMs(record: SessionRecord): number {
    const created = Date.parse(record.createdAt);
    const expires = Date.parse(record.expiresAt);
    const window = expires - created;
    return window > 0 ? window : 30 * 60_000;
  }

  /**
   * Is there a live step-up assertion covering this scope?
   *
   * Step-up expires independently of, and sooner than, the session (§5), so this is
   * a separate question from whether the session is valid.
   */
  static hasStepUp(record: SessionRecord, scope: string, now: Date = new Date()): boolean {
    if (record.steppedUpAt === undefined) return false;

    const at = Date.parse(record.steppedUpAt);
    if (!Number.isFinite(at)) return false;
    if (now.getTime() - at > STEP_UP_LIFETIME_MS) return false;

    // An assertion with no scope covers nothing. Scope is how a step-up for
    // "change my payment method" is prevented from unlocking break-glass.
    if (record.steppedUpScope === undefined) return false;
    return record.steppedUpScope === scope;
  }
}

/**
 * Fifteen minutes. Long enough to complete a sensitive flow, short enough that a
 * session stolen after the assertion is unlikely to still carry it.
 */
export const STEP_UP_LIFETIME_MS = 15 * 60_000;
