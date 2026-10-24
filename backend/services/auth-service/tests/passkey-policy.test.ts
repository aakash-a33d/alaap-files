import { describe, expect, it } from 'vitest';

import {
  MAX_CREDENTIALS_PER_ACCOUNT,
  checkSignCount,
  credentialDisplayName,
  deriveRpId,
  isUsable,
  policyFor,
} from '../src/domain/passkey-policy.ts';

describe('policy by role', () => {
  it('requires user verification and attestation for staff', () => {
    // Staff act on other people's records, so the fingerprint an attestation leaks
    // is worth the assurance it buys.
    for (const role of ['therapist', 'moderator', 'admin', 'safety_reviewer'] as const) {
      const p = policyFor(role);
      expect(p.userVerification, role).toBe('required');
      expect(p.attestation, role).toBe('direct');
      expect(p.residentKey, role).toBe('required');
    }
  });

  it('asks members for NO attestation', () => {
    // A direct attestation identifies the authenticator make and model, which is a
    // device fingerprint attached to a mental health account. For a member that is a
    // worse trade than the assurance it buys.
    for (const role of ['user', 'partner'] as const) {
      expect(policyFor(role).attestation, role).toBe('none');
    }
  });

  it('prefers discoverable credentials for members', () => {
    // So that signing in does not require typing a phone number, which on a
    // pseudonymous platform is an identity disclosure into a login form.
    expect(policyFor('user').residentKey).toBe('preferred');
  });
});

describe('clone detection', () => {
  it('accepts a counter that advances', () => {
    expect(checkSignCount(4, 5)).toEqual({ ok: true });
    expect(checkSignCount(0, 1)).toEqual({ ok: true });
  });

  it('refuses a counter that goes backwards or repeats', () => {
    // Either a cloned authenticator or a replayed assertion. Both are refusals.
    expect(checkSignCount(9, 8)).toEqual({ ok: false, reason: 'counter_regressed' });
    expect(checkSignCount(9, 9)).toEqual({ ok: false, reason: 'counter_regressed' });
  });

  it('accepts a permanent zero, which is normal rather than an attack', () => {
    // iCloud Keychain and Google Password Manager credentials always report zero,
    // because a credential that legitimately exists on several devices cannot keep
    // one counter. Treating that as a clone would lock out most real users.
    expect(checkSignCount(0, 0)).toEqual({ ok: true });
    expect(checkSignCount(42, 0)).toEqual({ ok: true });
  });
});

describe('credential display name', () => {
  it('is the public handle and nothing else', () => {
    // This string appears in the OS passkey picker. It must never carry a phone
    // number or anything from the identity vault.
    expect(credentialDisplayName('QuietRiver-4821')).toBe('QuietRiver-4821');
    expect(credentialDisplayName('QuietRiver-4821')).not.toMatch(/\d{10}/);
  });
});

describe('relying party id', () => {
  it('is the hostname, never the full origin', () => {
    // An rpId that is not a registrable suffix of the origin makes every credential
    // unusable, and the browser error says very little about why.
    expect(deriveRpId('https://alaap.in')).toBe('alaap.in');
    expect(deriveRpId('https://app.alaap.in:8443')).toBe('app.alaap.in');
    expect(deriveRpId('http://localhost:5173')).toBe('localhost');
  });
});

describe('credential lifecycle', () => {
  it('treats a revoked credential as unusable', () => {
    expect(isUsable({ revokedAt: null })).toBe(true);
    expect(isUsable({ revokedAt: '2026-09-11T00:00:00.000Z' })).toBe(false);
  });

  it('caps credentials per account at a number a person could plausibly hold', () => {
    expect(MAX_CREDENTIALS_PER_ACCOUNT).toBeGreaterThanOrEqual(3);
    expect(MAX_CREDENTIALS_PER_ACCOUNT).toBeLessThanOrEqual(20);
  });
});
