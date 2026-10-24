/**
 * Quotas, expiry and public refs.
 *
 * Loaded from the real plans file rather than a fixture, because that file IS the
 * policy — a test against an inline fixture would keep passing after somebody set the
 * free tier to zero posts or reintroduced reply gating.
 */

import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { freePlan, loadPlans } from '../src/config/plans.ts';
import {
  assertNeverGated,
  canExtendExpiry,
  checkQuota,
  expiryFor,
  NeverGatedError,
  planById,
  quotaPeriodEnd,
  quotaPeriodStart,
} from '../src/domain/quotas.ts';
import { generateRef, isWellFormedRef, refKind } from '../src/domain/refs.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const catalogue = loadPlans(ROOT);
const free = freePlan(catalogue);

describe('the plan catalogue', () => {
  it('loads, which means every startup invariant holds', () => {
    expect(catalogue.plans.length).toBeGreaterThan(0);
  });

  it('has exactly one free tier', () => {
    expect(catalogue.plans.filter((p) => p.tier === 0)).toHaveLength(1);
  });

  it('gives the free tier four posts and ten replies a month', () => {
    expect(free.quotas.postsPerMonth).toBe(4);
    expect(free.quotas.repliesWrittenPerMonth).toBe(10);
  });

  it('gives every plan the AI response', () => {
    for (const plan of catalogue.plans) {
      expect(plan.quotas.aiResponsesPerPost, plan.id).toBeGreaterThanOrEqual(1);
    }
  });

  it('expires posts after five days on every plan', () => {
    // Not a paid feature being withheld. Expiry is the default state of a post here;
    // paid plans buy the ability to EXTEND it.
    for (const plan of catalogue.plans) {
      expect(plan.quotas.postVisibilityDays, plan.id).toBe(5);
    }
  });

  it('never lets a higher tier buy less', () => {
    const ordered = [...catalogue.plans].sort((a, b) => a.tier - b.tier);
    for (let i = 1; i < ordered.length; i += 1) {
      const lo = ordered[i - 1]!.quotas.postsPerMonth;
      const hi = ordered[i]!.quotas.postsPerMonth;
      if (lo !== null && hi !== null) expect(hi).toBeGreaterThanOrEqual(lo);
    }
  });
});

describe('what a quota may never touch', () => {
  it('cannot gate replies to your own post', () => {
    // The guard against reintroducing reply-visibility gating. It was removed
    // deliberately: it saved nothing, and put an upgrade prompt in front of somebody
    // in acute distress.
    expect(() => assertNeverGated(catalogue, 'replies-to-your-own-post')).toThrow(NeverGatedError);
  });

  it('cannot gate the safety path', () => {
    for (const entitlement of [
      'crisis-resources',
      'safety-plan',
      'human-safety-escalation',
      'data-export',
      'account-deletion',
      'consent-withdrawal',
    ]) {
      expect(() => assertNeverGated(catalogue, entitlement), entitlement).toThrow(NeverGatedError);
    }
  });

  it('does not object to gating something that IS a paid feature', () => {
    expect(() => assertNeverGated(catalogue, 'journal-entry')).not.toThrow();
  });

  it('lists reply visibility as never gated, in the file itself', () => {
    expect(catalogue.neverGated.has('replies-to-your-own-post')).toBe(true);
  });
});

describe('counting a month', () => {
  const now = new Date('2026-09-14T08:30:00.000Z');

  it('starts at the first of the month, UTC', () => {
    expect(quotaPeriodStart(now).toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('ends at the first of the next one', () => {
    expect(quotaPeriodEnd(now).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('rolls the year over in December', () => {
    expect(quotaPeriodEnd(new Date('2026-12-20T00:00:00.000Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
});

describe('checking a quota', () => {
  const now = new Date('2026-09-14T08:30:00.000Z');

  it('allows a member below their limit, and says how many are left', () => {
    const d = checkQuota(free, 'posts_per_month', 1, now);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.remaining).toBe(3);
  });

  it('allows the very last one', () => {
    const d = checkQuota(free, 'posts_per_month', 3, now);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.remaining).toBe(1);
  });

  it('refuses the one after that, and says when it resets', () => {
    const d = checkQuota(free, 'posts_per_month', 4, now);
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.limit).toBe(4);
      expect(d.used).toBe(4);
      // A member has to be able to answer "when can I post again?" without asking.
      expect(d.resetsAt).toBe('2026-10-01T00:00:00.000Z');
    }
  });

  it('treats null as unlimited rather than as zero', () => {
    const paid = planById(catalogue, 'interaction-plus')!;
    const d = checkQuota(paid, 'posts_per_month', 10_000, now);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.remaining).toBeNull();
  });

  it('counts replies separately from posts', () => {
    expect(checkQuota(free, 'replies_written_per_month', 9, now).allowed).toBe(true);
    expect(checkQuota(free, 'replies_written_per_month', 10, now).allowed).toBe(false);
  });
});

describe('expiry', () => {
  const published = new Date('2026-09-14T08:00:00.000Z');

  it('is five days by default', () => {
    expect(expiryFor(free, published).toISOString()).toBe('2026-09-19T08:00:00.000Z');
  });

  it('cannot be extended on the free plan, whatever is asked for', () => {
    expect(expiryFor(free, published, 30).toISOString()).toBe('2026-09-19T08:00:00.000Z');
    expect(canExtendExpiry(free)).toBe(false);
  });

  it('can be extended to thirty days on a paid plan', () => {
    const paid = planById(catalogue, 'interaction-plus')!;
    expect(canExtendExpiry(paid)).toBe(true);
    expect(expiryFor(paid, published, 30).toISOString()).toBe('2026-10-14T08:00:00.000Z');
  });

  it('never SHORTENS a post below its plan default', () => {
    // A request for one day is a request to delete early, which is a different
    // operation with different consequences - not something an expiry field decides.
    const paid = planById(catalogue, 'interaction-plus')!;
    expect(expiryFor(paid, published, 1).toISOString()).toBe('2026-09-19T08:00:00.000Z');
  });

  it('clamps a request above the ceiling rather than refusing it', () => {
    const paid = planById(catalogue, 'interaction-plus')!;
    expect(expiryFor(paid, published, 365).toISOString()).toBe('2026-10-14T08:00:00.000Z');
  });
});

describe('public refs', () => {
  it('look like P-883920 and R-114872', () => {
    for (let i = 0; i < 200; i += 1) {
      const p = generateRef('post');
      const r = generateRef('reply');
      expect(p).toMatch(/^P-\d{6}$/);
      expect(r).toMatch(/^R-\d{6}$/);
      expect(isWellFormedRef(p)).toBe(true);
      expect(refKind(r)).toBe('reply');
    }
  });

  it('never start with a zero a member might drop when typing', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(generateRef('post').split('-')[1]![0]).not.toBe('0');
    }
  });

  it('vary — 500 draws are mostly distinct', () => {
    // Six digits is a small space, so collisions are expected and handled by the
    // UNIQUE constraint plus a retry. This only checks the generator is not stuck.
    const seen = new Set(Array.from({ length: 500 }, () => generateRef('post')));
    expect(seen.size).toBeGreaterThan(480);
  });

  it('reject anything else', () => {
    for (const bad of ['P-12345', 'P-1234567', 'X-123456', '123456', '', 'P123456']) {
      expect(isWellFormedRef(bad), bad).toBe(false);
      expect(refKind(bad), bad).toBeUndefined();
    }
  });
});
