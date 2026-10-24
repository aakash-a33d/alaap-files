/**
 * Granting and withdrawing, and the asymmetry between them.
 *
 * Granting is allowed to fail. Withdrawing is not, and most of this file exists to
 * pin that down: a member who cannot stop has not consented, they have been enrolled.
 */

import { describe, expect, it } from 'vitest';

import { Consent } from '../src/application/consent.ts';

const CALLER = { pseudoId: 7, requestId: '11111111-1111-4111-8111-111111111111' };

function harness(
  opts: {
    purposes?: string[];
    version?: string | undefined;
    hadGrant?: boolean;
    repoGranted?: boolean;
  } = {},
) {
  const audits: Array<Record<string, unknown>> = [];

  const repo = {
    async isGranted() {
      return opts.repoGranted ?? true;
    },
    async currentVersion() {
      return 'version' in opts ? opts.version : 'care-delivery-v1';
    },
    async grant(p: { pseudoId: number; purpose: string; versionId: string }) {
      return {
        id: 'r1',
        purpose: p.purpose,
        versionId: p.versionId,
        state: 'granted',
        grantedAt: '2026-09-17T00:00:00Z',
        withdrawnAt: null,
      };
    },
    async withdraw() {
      return opts.hadGrant ?? true;
    },
    async history() {
      return [];
    },
  };

  const consent = new Consent({
    repo: repo as never,
    purposes: new Set(opts.purposes ?? ['care-delivery', 'community-moderation']),
    audit: {
      async write(row: Record<string, unknown>) {
        audits.push(row);
      },
    } as never,
    log: { warn() {}, error() {} },
  });

  return { consent, audits };
}

describe('granting', () => {
  it('records which text was agreed to', async () => {
    // The version is the point. "Did they consent?" is answerable without it; "what did
    // they consent to?" is not, and that is the question asked years later.
    const { consent, audits } = harness();
    const out = await consent.grant(CALLER, 'care-delivery');

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.record.versionId).toBe('care-delivery-v1');
    expect(audits[0]!.context).toMatchObject({ consent_version: 'care-delivery-v1' });
  });

  it('refuses a purpose the platform has not declared', async () => {
    const { consent, audits } = harness();
    const out = await consent.grant(CALLER, 'selling-your-data');

    expect(out).toEqual({ ok: false, reason: 'unknown_purpose' });
    expect(audits).toHaveLength(0);
  });

  it('refuses a declared purpose with no published text', async () => {
    // Recording consent against nothing is worse than refusing. It produces a row that
    // looks like agreement and cannot say what was agreed to.
    const { consent, audits } = harness({ version: undefined });
    const out = await consent.grant(CALLER, 'care-delivery');

    expect(out).toEqual({ ok: false, reason: 'no_published_version' });
    expect(audits).toHaveLength(0);
  });
});

describe('a purpose removed from the registry', () => {
  it('is not granted, whatever the table still says', async () => {
    // The registry is the platform's live claim about what it processes for. A stale
    // row must not keep a retired purpose alive after the claim was withdrawn.
    const { consent } = harness({ purposes: ['care-delivery'], repoGranted: true });

    expect(await consent.isGranted(7, 'crisis-triage')).toBe(false);
    expect(await consent.isGranted(7, 'care-delivery')).toBe(true);
  });
});

describe('withdrawing', () => {
  it('is audited even when there was nothing to withdraw', async () => {
    // Otherwise "they never asked" and "we lost the record" are the same shape in the
    // trail, and only one of those is defensible.
    const { consent, audits } = harness({ hadGrant: false });
    await consent.withdraw(CALLER, 'care-delivery');

    expect(audits).toHaveLength(1);
    expect(audits[0]!.actionType).toBe('consent.withdrawn');
    expect(audits[0]!.context).toMatchObject({ consent_state: 'nothing_granted' });
  });

  it('distinguishes that from an actual withdrawal', async () => {
    const { consent, audits } = harness({ hadGrant: true });
    await consent.withdraw(CALLER, 'care-delivery');

    expect(audits[0]!.context).toMatchObject({ consent_state: 'withdrawn' });
  });

  it('accepts a purpose that is not in the registry at all', async () => {
    // Granting validates; withdrawing must not. Refusing to stop processing for a
    // purpose the member believes exists is indistinguishable, from where they are
    // standing, from ignoring them — and a retired purpose is exactly the case where
    // somebody's stored row might still be live.
    const { consent, audits } = harness({ purposes: ['care-delivery'] });
    await expect(consent.withdraw(CALLER, 'some-retired-purpose')).resolves.toBeUndefined();

    expect(audits).toHaveLength(1);
  });

  it('returns nothing a caller could turn into a refusal', async () => {
    // The signature is the guarantee. There is no outcome type here, so no route can
    // grow a branch that declines to withdraw.
    const { consent } = harness();
    expect(await consent.withdraw(CALLER, 'care-delivery')).toBeUndefined();
  });
});
