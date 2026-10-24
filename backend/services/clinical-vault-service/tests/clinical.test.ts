/**
 * The two gates in front of the journal, and the one surface that has none.
 *
 * These test ORDER and SILENCE, which are the two things the integration test cannot
 * see. clinical-flows.mjs proves a withdrawn member is refused; only a unit test can
 * prove they were refused for the right reason, or that the audit row written along
 * the way carried none of what they wrote.
 */

import { describe, expect, it } from 'vitest';

import { Clinical } from '../src/application/clinical.ts';
import type { PlanCatalogue } from '../src/domain/quotas.ts';

const PAID = {
  id: 'interaction-plus',
  name: 'Interaction Plus',
  tier: 2,
  quotas: {
    postsPerMonth: 30,
    repliesWrittenPerMonth: 100,
    aiResponsesPerPost: 1,
    postVisibilityDays: 30,
    postVisibilityExtendableToDays: null,
    journalEntriesPerMonth: 2,
    shortStoriesPerMonth: 2,
  },
  entitlements: ['private-journal'],
};

const FREE = {
  ...PAID,
  id: 'free',
  name: 'Free',
  tier: 0,
  // 0, not absent. The plans file says "not on this tier" with a zero, and a service
  // that read that as "no cap configured" would hand out the paid feature.
  quotas: { ...PAID.quotas, journalEntriesPerMonth: 0 },
  entitlements: ['private-journal'],
};

const catalogue = (...plans: typeof PAID[]): PlanCatalogue => ({
  plans,
  neverGated: new Set(['mood-checkin', 'consent-withdrawal']),
  postExpiryDefaultDays: 5,
});

const CALLER = { pseudoId: 7, requestId: '11111111-1111-4111-8111-111111111111' };

/** Records every call, in order, so a test can assert on what was NOT asked. */
function harness(
  opts: { consent?: boolean; used?: number; plan?: typeof PAID; defaultPlanId?: string } = {},
) {
  const calls: string[] = [];
  const audits: Array<Record<string, unknown>> = [];

  const records = {
    async countJournalSince() {
      calls.push('quota');
      return opts.used ?? 0;
    },
    async writeJournal(p: { pseudoId: number; body: string }) {
      calls.push('write');
      return {
        id: 'e1',
        body: p.body,
        entryDate: '2026-09-17',
        wordCount: p.body.split(/\s+/).length,
        privacyMode: 'standard',
        createdAt: '2026-09-17T00:00:00Z',
      };
    },
    async readJournal() {
      calls.push('read');
      return undefined;
    },
    async listJournal() {
      calls.push('list');
      return [];
    },
    async deleteJournal() {
      calls.push('delete');
      return false;
    },
    async recordMood(p: { moodScore: number }) {
      calls.push('mood');
      return {
        id: 'm1',
        moodScore: p.moodScore,
        energyScore: undefined,
        sleepHours: undefined,
        emotionTags: [],
        entryDate: '2026-09-17',
      };
    },
    async moodHistory() {
      calls.push('moodHistory');
      return [];
    },
  };

  const consent = {
    async allows() {
      calls.push('consent');
      return opts.consent ?? true;
    },
  };

  const audit = {
    async write(row: Record<string, unknown>) {
      calls.push(`audit:${String(row.actionType)}`);
      audits.push(row);
    },
  };

  const clinical = new Clinical({
    records: records as never,
    consent: consent as never,
    audit: audit as never,
    catalogue: catalogue(opts.plan ?? PAID),
    defaultPlanId: opts.defaultPlanId ?? (opts.plan ?? PAID).id,
    log: { warn() {}, error() {} },
  });

  return { clinical, calls, audits };
}

describe('the gates, in order', () => {
  it('asks about consent before it asks about quota', async () => {
    // Order is the assertion. A member who withdrew consent must not be told they have
    // run out of an allowance they stopped using — that reads as "pay us to continue"
    // at the exact moment they asserted control.
    const { clinical, calls } = harness({ consent: false });
    const out = await clinical.writeJournal(CALLER, { body: 'something' });

    expect(out).toEqual({ ok: false, reason: 'consent_withdrawn' });
    expect(calls).toEqual(['consent']);
    expect(calls).not.toContain('quota');
  });

  it('refuses on entitlement before it touches consent at all', async () => {
    // Nothing is asked about a member on a plan without the feature. Checking consent
    // first would record a consent decision for processing that was never going to
    // happen, which pollutes the trail with events that did not occur.
    const { clinical, calls } = harness({ plan: FREE });
    const out = await clinical.writeJournal(CALLER, { body: 'something' });

    expect(out).toEqual({ ok: false, reason: 'not_entitled' });
    expect(calls).toEqual([]);
  });

  it('distinguishes a quota refusal from both of them', async () => {
    const { clinical } = harness({ used: 2 });
    const out = await clinical.writeJournal(CALLER, { body: 'something' });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe('quota_exceeded');
  });

  it('refuses to start at all if the configured plan is not in the catalogue', async () => {
    // A typo in DEFAULT_PLAN_ID must not silently become "no entitlements" — that
    // fails closed in a way that looks like a billing decision.
    const { clinical } = harness({ defaultPlanId: 'nonexistent' });
    await expect(clinical.writeJournal(CALLER, { body: 'x' })).rejects.toThrow(/not in the plan catalogue/);
  });
});

describe('what the audit vault is told', () => {
  it('records that an entry exists and nothing about what is in it', async () => {
    const { clinical, audits } = harness();
    const secret = 'the specific thing I have not said out loud';
    await clinical.writeJournal(CALLER, { body: secret });

    expect(audits).toHaveLength(1);
    const row = audits[0]!;
    const serialised = JSON.stringify(row);

    expect(row.actionType).toBe('clinical.journal.written');
    expect(serialised).not.toContain(secret);
    expect(serialised).not.toContain('specific thing');
    // Not the length either. Word count is weak, but it is still a measurement of the
    // content, and the audit vault has a different retention policy and different
    // readers than the vault the content lives in.
    expect(row.context).not.toHaveProperty('word_count');
    expect(row.context).not.toHaveProperty('entry_date');
  });

  it('never puts a mood score in the trail', async () => {
    const { clinical, audits } = harness();
    await clinical.recordMood(CALLER, { moodScore: 2 });

    expect(audits[0]!.actionType).toBe('clinical.mood.recorded');
    expect(audits[0]!.context).not.toHaveProperty('mood_score');
    expect(JSON.stringify(audits[0]!.context)).not.toContain('2');
  });

  it('writes no audit row when a delete deleted nothing', async () => {
    // A row for a delete that did not happen makes the trail claim a record was
    // destroyed. Deletion evidence is retained permanently and relied on to prove
    // compliance; a false one is worse than a missing one.
    const { clinical, audits } = harness();
    const gone = await clinical.deleteJournal(CALLER, 'not-mine');

    expect(gone).toBe(false);
    expect(audits).toHaveLength(0);
  });

  it('logs no decrypt event for a list, because nothing was decrypted', async () => {
    const { clinical, calls } = harness();
    await clinical.listJournal(CALLER);

    expect(calls).toEqual(['list']);
    expect(calls.some((c) => c.startsWith('audit:'))).toBe(false);
  });
});

describe('mood is never gated', () => {
  it('is recorded for a member on a plan with no journal entitlement', async () => {
    const { clinical, calls } = harness({ plan: FREE });
    const out = await clinical.recordMood(CALLER, { moodScore: 4 });

    expect(out.moodScore).toBe(4);
    expect(calls).toContain('mood');
  });

  it('never asks consent-service anything', async () => {
    // Not an optimisation. Mood is the lowest-friction way for somebody to begin
    // engaging at all, and a consent check is a place it could start failing.
    const { clinical, calls } = harness({ consent: false, plan: FREE, used: 9999 });
    await clinical.recordMood(CALLER, { moodScore: 1 });

    expect(calls).not.toContain('consent');
    expect(calls).not.toContain('quota');
  });
});

describe('a record the platform cannot read', () => {
  it('produces no decrypt event, because no decrypt happened', async () => {
    // privacy_mode = 'maximum'. The audit registry states the platform holds no key
    // for these; a decrypt row against one would be a false claim in a trail whose
    // only value is that it is not.
    const sealed = {
      id: 'e9',
      entryDate: '2026-09-17',
      wordCount: 12,
      privacyMode: 'maximum' as const,
      createdAt: '2026-09-17T00:00:00Z',
      readable: false as const,
    };
    const { clinical, calls, audits } = harness();
    (clinical as never as { deps: { records: { readJournal: () => Promise<unknown> } } }).deps.records.readJournal =
      async () => {
        calls.push('read');
        return sealed;
      };

    const out = await clinical.readJournal(CALLER, 'e9');

    expect(out).toEqual(sealed);
    expect(audits).toHaveLength(0);
  });
});
