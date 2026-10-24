/**
 * The second factor, and the two ways it goes quietly wrong.
 *
 * Until this existed, `/api/data-rights`, `/api/admin` and `/api/break-glass` answered
 * 403 to everyone: the gateway checked `steppedUpAt` and `steppedUpScope`, and nothing
 * in the codebase ever wrote them. A control that is enforced and unsatisfiable looks
 * exactly like a control that works, which is why it survived four milestones.
 *
 * The live suite can prove a step-up opens the right door. It cannot wait fifteen
 * minutes for one to expire, and it cannot easily reach the other two step-up groups,
 * which need roles an ordinary member does not have. Both are here.
 */

import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { loadMetadata } from '../src/config/metadata.ts';
import { SessionStore, STEP_UP_LIFETIME_MS } from '../src/infrastructure/session-store.ts';
import { applyStepUp } from '../src/routes/step-up.ts';
import type { ApiGroup, SessionRecord } from '../src/types.ts';

const metadata = loadMetadata();

const DATA_RIGHTS = '/api/data-rights';
const body = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8');

/* No default parameter: passing `undefined` to one silently supplies the default,
   which is how this helper first reported a session-less request as stamped. */
function fakeReq(token: string | undefined): Request {
  return {
    ctx: { requestId: 'r1', sessionToken: token, startedAt: 0 },
    log: { warn: vi.fn(), info: vi.fn() },
  } as never;
}

/** A store that records what it was asked to stamp, without Redis. */
function fakeStore() {
  const granted: { token: string; scope: string }[] = [];
  return {
    granted,
    store: {
      async grantStepUp(token: string, scope: string) {
        granted.push({ token, scope });
      },
    } as unknown as SessionStore,
  };
}

function session(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: 's1',
    pseudoId: 7,
    actorRole: 'user',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    absoluteExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    lastActiveAt: new Date().toISOString(),
    ...over,
  } as SessionRecord;
}

describe('granting', () => {
  it('stamps the session when a verified answer names a guarded door', async () => {
    const { store, granted } = fakeStore();
    const scope = await applyStepUp(
      fakeReq('alaap_tok'),
      store,
      metadata.groups,
      200,
      body({ steppedUp: true, scope: DATA_RIGHTS }),
    );

    expect(scope).toBe(DATA_RIGHTS);
    expect(granted).toEqual([{ token: 'alaap_tok', scope: DATA_RIGHTS }]);
  });

  it('refuses a scope for a group that does not require step-up', async () => {
    // Verified, but pointless — and worse than pointless if it were stored, because a
    // stray assertion is one somebody later reasons about as though it meant something.
    const { store, granted } = fakeStore();
    const scope = await applyStepUp(
      fakeReq('alaap_tok'),
      store,
      metadata.groups,
      200,
      body({ steppedUp: true, scope: '/api/consent' }),
    );

    expect(scope).toBeUndefined();
    expect(granted).toEqual([]);
  });

  it('refuses a scope that is not a group at all', async () => {
    const { store, granted } = fakeStore();
    await applyStepUp(
      fakeReq('alaap_tok'),
      store,
      metadata.groups,
      200,
      body({ steppedUp: true, scope: '/api/../admin' }),
    );
    expect(granted).toEqual([]);
  });

  it('ignores an answer that does not claim a step-up', async () => {
    const { store, granted } = fakeStore();
    await applyStepUp(fakeReq('alaap_tok'), store, metadata.groups, 200, body({ recoveryCodes: ['a', 'b'] }));
    expect(granted).toEqual([]);
  });

  it('ignores a failed response that claims one anyway', async () => {
    const { store, granted } = fakeStore();
    await applyStepUp(
      fakeReq('alaap_tok'),
      store,
      metadata.groups,
      401,
      body({ steppedUp: true, scope: DATA_RIGHTS }),
    );
    expect(granted).toEqual([]);
  });

  it('does nothing without a session to stamp', async () => {
    const { store, granted } = fakeStore();
    await applyStepUp(
      fakeReq(undefined),
      store,
      metadata.groups,
      200,
      body({ steppedUp: true, scope: DATA_RIGHTS }),
    );
    expect(granted).toEqual([]);
  });
});

describe('what an assertion is worth', () => {
  it('opens only the scope it was granted for', () => {
    // A step-up to export your own data must never unlock break-glass. These are not
    // degrees of one sensitivity; they are different questions, and agreeing to one is
    // not agreeing to the other.
    const record = session({ steppedUpAt: new Date().toISOString(), steppedUpScope: DATA_RIGHTS });

    expect(SessionStore.hasStepUp(record, DATA_RIGHTS)).toBe(true);
    expect(SessionStore.hasStepUp(record, '/api/break-glass')).toBe(false);
    expect(SessionStore.hasStepUp(record, '/api/admin')).toBe(false);
  });

  it('expires on its own, sooner than the session', () => {
    // The session below is good for another day. The assertion is not.
    const stale = new Date(Date.now() - STEP_UP_LIFETIME_MS - 1000).toISOString();
    const record = session({ steppedUpAt: stale, steppedUpScope: DATA_RIGHTS });

    expect(SessionStore.hasStepUp(record, DATA_RIGHTS)).toBe(false);
    expect(Date.parse(record.absoluteExpiresAt)).toBeGreaterThan(Date.now());
  });

  it('is nothing without a scope', () => {
    const record = session({ steppedUpAt: new Date().toISOString() });
    expect(SessionStore.hasStepUp(record, DATA_RIGHTS)).toBe(false);
  });

  it('is nothing on a session that never stepped up', () => {
    expect(SessionStore.hasStepUp(session(), DATA_RIGHTS)).toBe(false);
  });
});

describe('the route policy', () => {
  it('still guards every group that should need a second factor', () => {
    const guarded = metadata.groups.filter((g: ApiGroup) => g.stepUp).map((g) => g.prefix);
    expect(guarded).toEqual(
      expect.arrayContaining(['/api/data-rights', '/api/admin', '/api/break-glass']),
    );
  });

  it('lets exactly one group grant one', () => {
    // The group that grants must be the one that actually verifies a code. If a second
    // ever appears, somebody has to have decided that deliberately.
    const granting = metadata.groups.filter((g: ApiGroup) => g.stepUpGrant).map((g) => g.prefix);
    expect(granting).toEqual(['/api/account']);
  });

  it('never lets an unauthenticated group grant one', () => {
    // There would be no session to stamp, and no caller to have proved anything.
    for (const g of metadata.groups) {
      if (g.authentication === 'none') expect(g.stepUpGrant).toBe(false);
    }
  });
});
