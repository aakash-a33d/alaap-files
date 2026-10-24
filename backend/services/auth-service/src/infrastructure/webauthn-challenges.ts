/**
 * WebAuthn challenge store.
 *
 * A challenge is single-use and short-lived. Both properties matter: reuse would let
 * a captured assertion be replayed, and a long life would widen the window in which
 * a captured registration could be completed by somebody else.
 *
 * Redis, because a challenge is worthless five minutes after it is issued and a TTL
 * does the cleanup for nothing.
 */

import type { Redis } from 'ioredis';

import { CHALLENGE_TTL_SECONDS } from '../domain/passkey-policy.ts';

const PREFIX = 'webauthn:challenge:';

export interface StoredChallenge {
  challenge: string;
  intent: 'register' | 'login';
  /** Present for registration, which happens inside an existing session. */
  accountId?: string;
  createdAt: string;
}

export class WebAuthnChallengeStore {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async put(challengeId: string, value: StoredChallenge): Promise<void> {
    await this.redis.set(PREFIX + challengeId, JSON.stringify(value), 'EX', CHALLENGE_TTL_SECONDS);
  }

  /**
   * Read and delete in one step.
   *
   * Single-use is enforced here rather than by the caller remembering to clean up.
   * A caller that reads without consuming would leave a replayable challenge alive
   * for its full TTL, and that is exactly the kind of mistake that is invisible until
   * somebody exploits it.
   */
  async consume(challengeId: string): Promise<StoredChallenge | undefined> {
    const key = PREFIX + challengeId;
    const raw = await this.redis.getdel(key);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as StoredChallenge;
    } catch {
      return undefined;
    }
  }
}
