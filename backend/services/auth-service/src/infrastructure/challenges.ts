/**
 * OTP challenge store, and the send-rate policy around it.
 *
 * Redis rather than Postgres: challenges live five minutes and are worthless
 * afterwards, so durability buys nothing and a TTL does the cleanup for free.
 *
 * A challenge never holds a phone number — only the blind index. So a dump of this
 * keyspace yields hashes and attempt counts, and cannot be turned back into a list of
 * who tried to register.
 */

import type { Redis } from 'ioredis';

import {
  CHALLENGE_TTL_SECONDS,
  MAX_ATTEMPTS,
  MAX_SENDS_PER_NUMBER_PER_HOUR,
  RESEND_COOLDOWN_SECONDS,
  type OtpChallenge,
} from '../domain/otp.ts';

const CHALLENGE_PREFIX = 'otp:challenge:';
const SEND_COUNT_PREFIX = 'otp:sends:';
const COOLDOWN_PREFIX = 'otp:cooldown:';
const RECOVERY_PREFIX = 'recovery:attempts:';

/**
 * Recovery attempts per handle per hour.
 *
 * A recovery code carries roughly fifty bits, so brute force is not the threat — the
 * threat is somebody working through a sheet they found, or through the handful of
 * codes a shoulder-surfer glimpsed. Five an hour makes that impractical while leaving
 * room for the typos of someone reading their own handwriting under stress.
 */
const MAX_RECOVERY_ATTEMPTS_PER_HOUR = 5;

export type SendGate =
  | { allowed: true }
  | { allowed: false; reason: 'cooldown' | 'hourly_limit'; retryAfterSeconds: number };

export class ChallengeStore {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * May another code be sent to this number?
   *
   * Two limits, doing different jobs. The cooldown stops a "resend" button becoming
   * an SMS-cost amplifier pointed at us and a harassment vector pointed at whoever
   * owns the number. The hourly cap bounds the total either way.
   *
   * Keyed by the blind index, so the limit follows the NUMBER rather than the
   * session — otherwise clearing cookies would reset it.
   */
  async checkSendGate(mobileHashHex: string): Promise<SendGate> {
    const cooldownKey = COOLDOWN_PREFIX + mobileHashHex;
    const ttl = await this.redis.ttl(cooldownKey);
    if (ttl > 0) {
      return { allowed: false, reason: 'cooldown', retryAfterSeconds: ttl };
    }

    const countKey = SEND_COUNT_PREFIX + mobileHashHex;
    const sent = Number((await this.redis.get(countKey)) ?? 0);
    if (sent >= MAX_SENDS_PER_NUMBER_PER_HOUR) {
      const remaining = await this.redis.ttl(countKey);
      return {
        allowed: false,
        reason: 'hourly_limit',
        retryAfterSeconds: remaining > 0 ? remaining : 3600,
      };
    }

    return { allowed: true };
  }

  async recordSend(mobileHashHex: string): Promise<void> {
    const countKey = SEND_COUNT_PREFIX + mobileHashHex;
    const pipeline = this.redis.multi();
    pipeline.incr(countKey);
    // Only set the window on the first send, so a burst cannot keep extending it.
    pipeline.expire(countKey, 3600, 'NX');
    pipeline.set(COOLDOWN_PREFIX + mobileHashHex, '1', 'EX', RESEND_COOLDOWN_SECONDS);
    await pipeline.exec();
  }

  /** Is another recovery attempt permitted for this handle? */
  async checkRecoveryGate(handleLower: string): Promise<SendGate> {
    const key = RECOVERY_PREFIX + handleLower;
    const used = Number((await this.redis.get(key)) ?? 0);
    if (used >= MAX_RECOVERY_ATTEMPTS_PER_HOUR) {
      const ttl = await this.redis.ttl(key);
      return { allowed: false, reason: 'hourly_limit', retryAfterSeconds: ttl > 0 ? ttl : 3600 };
    }
    return { allowed: true };
  }

  /**
   * Counted on ATTEMPT, not on failure.
   *
   * Counting only failures would let an attacker interleave a known-good code to
   * reset nothing and keep guessing; counting every attempt bounds the total.
   */
  async recordRecoveryAttempt(handleLower: string): Promise<void> {
    const key = RECOVERY_PREFIX + handleLower;
    const pipeline = this.redis.multi();
    pipeline.incr(key);
    pipeline.expire(key, 3600, 'NX');
    await pipeline.exec();
  }

  async put(challenge: OtpChallenge): Promise<void> {
    await this.redis.set(
      CHALLENGE_PREFIX + challenge.challengeId,
      JSON.stringify(challenge),
      'EX',
      CHALLENGE_TTL_SECONDS,
    );
  }

  async get(challengeId: string): Promise<OtpChallenge | undefined> {
    const raw = await this.redis.get(CHALLENGE_PREFIX + challengeId);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as OtpChallenge;
    } catch {
      await this.redis.del(CHALLENGE_PREFIX + challengeId);
      return undefined;
    }
  }

  /**
   * Spend an attempt.
   *
   * Incremented BEFORE the code is compared, so a crash between the two costs the
   * caller an attempt rather than granting a free one. Failing towards the stricter
   * outcome is the right direction for a brute-force control.
   */
  async spendAttempt(challengeId: string): Promise<number> {
    const challenge = await this.get(challengeId);
    if (challenge === undefined) return MAX_ATTEMPTS;
    const used = challenge.attemptsUsed + 1;
    const ttl = await this.redis.ttl(CHALLENGE_PREFIX + challengeId);
    await this.redis.set(
      CHALLENGE_PREFIX + challengeId,
      JSON.stringify({ ...challenge, attemptsUsed: used }),
      'EX',
      ttl > 0 ? ttl : 1,
    );
    return used;
  }

  /** Burn a challenge on success, so a verified code cannot be replayed. */
  async consume(challengeId: string): Promise<void> {
    await this.redis.del(CHALLENGE_PREFIX + challengeId);
  }
}
