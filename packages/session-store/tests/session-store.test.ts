/**
 * The mint/resolve round trip, which is the property that matters most:
 * auth-service writes and the gateway reads, and if the two disagree by one field
 * every login succeeds and every subsequent request 401s.
 */

import { describe, expect, it } from 'vitest';

import {
  SESSION_POLICY,
  STEP_UP_LIFETIME_MS,
  SessionStore,
  hasStepUp,
  mintToken,
  safeEqual,
  sessionKey,
  type RedisLike,
  type SessionRecord,
} from '../src/index.ts';

/** In-memory Redis with TTL, enough to exercise expiry without a container. */
function fakeRedis(): RedisLike & { store: Map<string, { value: string; expiresAt: number }> } {
  const store = new Map<string, { value: string; expiresAt: number }>();
  return {
    store,
    async get(key) {
      const hit = store.get(key);
      if (hit === undefined) return null;
      if (Date.now() >= hit.expiresAt) {
        store.delete(key);
        return null;
      }
      return hit.value;
    },
    async set(key, value, _mode, ttlSeconds) {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return 'OK';
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
    async keys() {
      return [...store.keys()];
    },
  };
}

describe('tokens', () => {
  it('are opaque and high-entropy', () => {
    const a = mintToken();
    const b = mintToken();
    expect(a).not.toBe(b);
    expect(a.startsWith('alaap_')).toBe(true);
    expect(a.length).toBeGreaterThan(40);
  });

  it('are never the storage key', () => {
    const token = mintToken();
    const key = sessionKey(token);
    expect(key).toMatch(/^session:[0-9a-f]{64}$/);
    expect(key).not.toContain(token.slice(6));
  });

  it('compare in constant time, and reject a length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('mint then resolve — the writer and the reader agree', () => {
  it('round-trips every field', async () => {
    const store = new SessionStore(fakeRedis());
    const { token, record } = await store.mint({
      accountId: 'acc-1',
      pseudoId: 847291,
      actorRole: 'user',
      deviceId: 'dev-1',
    });

    const found = await store.resolve(token);
    expect(found).toBeDefined();
    expect(found!.record.sessionId).toBe(record.sessionId);
    expect(found!.record.accountId).toBe('acc-1');
    expect(found!.record.pseudoId).toBe(847291);
    expect(found!.record.actorRole).toBe('user');
    expect(found!.record.deviceId).toBe('dev-1');
  });

  it('returns nothing for an unknown token', async () => {
    const store = new SessionStore(fakeRedis());
    expect(await store.resolve(mintToken())).toBeUndefined();
  });

  it('carries no personal data in the record', async () => {
    const store = new SessionStore(fakeRedis());
    const { record } = await store.mint({ accountId: 'a', pseudoId: 1, actorRole: 'user' });
    const keys = Object.keys(record);
    for (const forbidden of ['mobile', 'name', 'legalName', 'email', 'plan', 'planTier']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe('lifetimes by role', () => {
  it('gives staff shorter absolute lifetimes than members', () => {
    // §5: a stolen staff session is worth more to an attacker than a member's.
    expect(SESSION_POLICY.admin.absoluteHours).toBeLessThan(SESSION_POLICY.user.absoluteHours);
    expect(SESSION_POLICY.therapist.absoluteHours).toBeLessThan(SESSION_POLICY.user.absoluteHours);
    expect(SESSION_POLICY.safety_reviewer.slidingMinutes).toBeLessThanOrEqual(
      SESSION_POLICY.user.slidingMinutes,
    );
  });

  it('applies the role policy at mint time', async () => {
    const store = new SessionStore(fakeRedis());
    const { record } = await store.mint({ accountId: 'a', pseudoId: 1, actorRole: 'admin' });
    const span = Date.parse(record.absoluteExpiresAt) - Date.parse(record.createdAt);
    expect(span).toBe(SESSION_POLICY.admin.absoluteHours * 3_600_000);
  });

  it('lets a caller shorten a window but never lengthen it', async () => {
    const store = new SessionStore(fakeRedis());
    const shorter = await store.mint({
      accountId: 'a', pseudoId: 1, actorRole: 'user', slidingMinutes: 5,
    });
    const shortSpan =
      Date.parse(shorter.record.expiresAt) - Date.parse(shorter.record.createdAt);
    expect(shortSpan).toBe(5 * 60_000);

    const longer = await store.mint({
      accountId: 'a', pseudoId: 1, actorRole: 'user', slidingMinutes: 9999,
    });
    const longSpan = Date.parse(longer.record.expiresAt) - Date.parse(longer.record.createdAt);
    expect(longSpan).toBe(SESSION_POLICY.user.slidingMinutes * 60_000);
  });
});

describe('expiry', () => {
  it('drops an expired session rather than sliding it back to life', async () => {
    const redis = fakeRedis();
    const store = new SessionStore(redis);
    const { token } = await store.mint({ accountId: 'a', pseudoId: 1, actorRole: 'user' });

    // Rewrite the stored record as already expired, leaving the TTL alone so the
    // fake does not evict it for us — we want the store's own check to fire.
    const key = sessionKey(token);
    const raw = JSON.parse((await redis.get(key))!) as SessionRecord;
    await redis.set(
      key,
      JSON.stringify({ ...raw, expiresAt: new Date(Date.now() - 1000).toISOString() }),
      'EX',
      600,
    );

    expect(await store.resolve(token)).toBeUndefined();
    expect(await redis.get(key)).toBeNull();
  });

  it('never slides past the absolute expiry', async () => {
    const redis = fakeRedis();
    const store = new SessionStore(redis);
    const { token } = await store.mint({ accountId: 'a', pseudoId: 1, actorRole: 'user' });

    const key = sessionKey(token);
    const raw = JSON.parse((await redis.get(key))!) as SessionRecord;
    await redis.set(
      key,
      JSON.stringify({
        ...raw,
        absoluteExpiresAt: new Date(Date.now() + 4000).toISOString(),
      }),
      'EX',
      600,
    );

    const found = await store.resolve(token);
    expect(found).toBeDefined();
    expect(found!.ttlSeconds).toBeLessThanOrEqual(4);
  });

  it('drops a record claiming a longer lifetime than the deployment permits', async () => {
    const redis = fakeRedis();
    const store = new SessionStore(redis, 1); // one hour ceiling
    const { token } = await store.mint({ accountId: 'a', pseudoId: 1, actorRole: 'user' });
    // user policy is 720h, which exceeds the ceiling — the guard should fire.
    expect(await store.resolve(token)).toBeUndefined();
  });

  it('drops a malformed record', async () => {
    const redis = fakeRedis();
    const store = new SessionStore(redis);
    await redis.set(sessionKey('tok'), 'not json', 'EX', 600);
    expect(await store.resolve('tok')).toBeUndefined();
  });
});

describe('revocation', () => {
  it('revokes one session', async () => {
    const store = new SessionStore(fakeRedis());
    const { token } = await store.mint({ accountId: 'a', pseudoId: 1, actorRole: 'user' });
    await store.revoke(token);
    expect(await store.resolve(token)).toBeUndefined();
  });

  it('logs an account out everywhere, and leaves other accounts alone', async () => {
    const store = new SessionStore(fakeRedis());
    const a1 = await store.mint({ accountId: 'acc-a', pseudoId: 1, actorRole: 'user' });
    const a2 = await store.mint({ accountId: 'acc-a', pseudoId: 1, actorRole: 'user' });
    const b1 = await store.mint({ accountId: 'acc-b', pseudoId: 2, actorRole: 'user' });

    expect(await store.revokeAllForAccount('acc-a')).toBe(2);
    expect(await store.resolve(a1.token)).toBeUndefined();
    expect(await store.resolve(a2.token)).toBeUndefined();
    expect(await store.resolve(b1.token)).toBeDefined();
  });
});

describe('step-up assertions', () => {
  const base: SessionRecord = {
    sessionId: 's', accountId: 'a', pseudoId: 1, actorRole: 'user',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
    absoluteExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };

  it('requires a matching scope', () => {
    const rec = { ...base, steppedUpAt: new Date().toISOString(), steppedUpScope: '/api/billing' };
    expect(hasStepUp(rec, '/api/billing')).toBe(true);
    // A step-up for a payment method must not unlock break-glass.
    expect(hasStepUp(rec, '/api/break-glass')).toBe(false);
  });

  it('expires sooner than the session', () => {
    const rec = {
      ...base,
      steppedUpAt: new Date(Date.now() - STEP_UP_LIFETIME_MS - 1000).toISOString(),
      steppedUpScope: '/api/admin',
    };
    expect(hasStepUp(rec, '/api/admin')).toBe(false);
  });

  it('treats a scopeless assertion as covering nothing', () => {
    expect(hasStepUp({ ...base, steppedUpAt: new Date().toISOString() }, '/api/admin')).toBe(false);
  });
});
