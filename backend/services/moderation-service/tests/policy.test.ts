/**
 * The moderation policy.
 *
 * Loaded from the real metadata files, not fixtures. The loudest invariant is that the
 * category list still matches A1's enum: an id that differs by one character produces
 * verdicts nobody can join to anything, and nothing else in the system would notice.
 */

import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPolicy } from '../src/config/policy.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const policy = loadPolicy(ROOT);

describe('the policy files', () => {
  it('load, which means every startup invariant holds', () => {
    expect(policy.categories.length).toBeGreaterThan(0);
  });

  it('declare all sixteen A1 categories', () => {
    // loadPolicy throws on a mismatch in either direction; this states the number so
    // a silent shrink is visible in the test name rather than only in an exception.
    expect(policy.categories).toHaveLength(16);
  });

  it('give every category a severity between 1 and 5', () => {
    for (const c of policy.categories) {
      expect(c.severity, c.id).toBeGreaterThanOrEqual(1);
      expect(c.severity, c.id).toBeLessThanOrEqual(5);
    }
  });

  it('rank the categories that reach past the platform highest', () => {
    const severity = new Map(policy.categories.map((c) => [c.id, c.severity]));
    for (const id of ['self_harm_encouragement', 'grooming_exploitation', 'sexual_exploitation']) {
      expect(severity.get(id), id).toBe(5);
    }
  });
});

describe('report reasons', () => {
  it('are offered in a member’s own words, not the classifier’s', () => {
    // The sixteen categories are what A1 tries to detect. These are what a person
    // would actually say, and the two lists are deliberately different.
    const ids = policy.reportReasons.map((r) => r.id);
    expect(ids).toContain('cruel_or_demeaning');
    expect(ids).not.toContain('bullying_harassment');
  });

  it('route only to categories that exist', () => {
    // A reason routing to a category that is not real would silently land in the
    // general queue, which reads as a triage decision rather than a typo.
    for (const reason of policy.reportReasons) {
      if (reason.routesTo !== null) {
        expect(policy.categoryIds.has(reason.routesTo), reason.id).toBe(true);
      }
    }
  });

  it('mark the ones that must reach a human as urgent', () => {
    const urgent = policy.reportReasons.filter((r) => r.urgent).map((r) => r.id);
    // A1 has no working detector for self-harm encouragement, so a member's report is
    // the only signal there is.
    expect(urgent).toContain('encouraging_self_harm');
    expect(urgent).toContain('threatening');
    expect(urgent).toContain('sexual_or_predatory');
  });

  it('include a catch-all that routes nowhere', () => {
    const catchAll = policy.reportReasons.find((r) => r.id === 'something_else');
    expect(catchAll).toBeDefined();
    // A taxonomy that forces somebody to pick the nearest wrong box loses the thing
    // they were reporting.
    expect(catchAll?.routesTo).toBeNull();
  });

  it('give every reason words a person can read', () => {
    for (const r of policy.reportReasons) {
      expect(r.label.length, r.id).toBeGreaterThan(2);
      expect(r.blurb.length, r.id).toBeGreaterThan(8);
    }
  });
});

describe('appeal reasons', () => {
  it('ask why the decision was wrong, not what somebody did', () => {
    const ids = policy.appealReasons.map((r) => r.id);
    expect(ids).toContain('misunderstood');
    expect(ids).toContain('my_own_experience');
    expect(ids).toContain('something_else');
  });

  it('cover being read in the wrong language', () => {
    // passive_aggressive_abuse is enforced in English only, and Hinglish is where the
    // classifier is least reliable. A member has to be able to say so.
    expect(policy.appealReasons.map((r) => r.id)).toContain('wrong_language_read');
  });

  it('are not the same list as report reasons', () => {
    const report = new Set(policy.reportReasons.map((r) => r.id));
    const appealOnly = policy.appealReasons.filter((r) => !report.has(r.id));
    expect(appealOnly.length).toBeGreaterThan(2);
  });
});
