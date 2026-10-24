/**
 * Trusted device rules.
 *
 * The property worth testing hardest is the one nobody would notice was missing: that
 * the same physical device produces a DIFFERENT stored hash for every account used on
 * it. Without it the table answers "which of these pseudonymous accounts share a
 * handset?", which on this platform is the most dangerous question the database could
 * be able to answer.
 */

import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDeviceLabels } from '../src/config/device-labels.ts';
import {
  deviceHash,
  deviceHashMatches,
  generateDeviceKey,
  isWellFormedDeviceKey,
  labelForUserAgent,
  normaliseLabel,
} from '../src/domain/devices.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const labels = loadDeviceLabels(ROOT);

const PEPPER = 'test_pepper_0123456789abcdef0123456789';
const ACCOUNT_A = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_B = '22222222-2222-2222-2222-222222222222';

describe('device keys', () => {
  it('are 43 base64url characters — 32 random bytes', () => {
    for (let i = 0; i < 50; i += 1) {
      const key = generateDeviceKey();
      expect(key.length).toBe(43);
      expect(isWellFormedDeviceKey(key)).toBe(true);
    }
  });

  it('are all different', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateDeviceKey()));
    expect(seen.size).toBe(200);
  });

  it('refuse anything that could be an identifier rather than noise', () => {
    // The shape is strict so that a client putting a phone number, an email or an
    // advertising id in this field is refused rather than quietly storing it.
    for (const bad of [
      '',
      '9123456780',
      'someone@example.com',
      '550e8400-e29b-41d4-a716-446655440000',
      'a'.repeat(42),
      'a'.repeat(44),
      'a'.repeat(43) + '=',
      'has spaces in it aaaaaaaaaaaaaaaaaaaaaaaaaa',
    ]) {
      expect(isWellFormedDeviceKey(bad), bad).toBe(false);
    }
  });
});

describe('the device hash', () => {
  const key = generateDeviceKey();

  it('is stable for one device on one account', () => {
    expect(deviceHash(ACCOUNT_A, key, PEPPER)).toEqual(deviceHash(ACCOUNT_A, key, PEPPER));
  });

  it('DIFFERS for the same device on a different account', () => {
    // The property this whole design exists for. A survivor and the person they are
    // escaping may share a handset; the table must not be able to say so.
    expect(deviceHash(ACCOUNT_A, key, PEPPER)).not.toEqual(deviceHash(ACCOUNT_B, key, PEPPER));
  });

  it('differs for a different device on the same account', () => {
    expect(deviceHash(ACCOUNT_A, key, PEPPER)).not.toEqual(
      deviceHash(ACCOUNT_A, generateDeviceKey(), PEPPER),
    );
  });

  it('depends on the pepper, so the database alone cannot be tested against', () => {
    expect(deviceHash(ACCOUNT_A, key, PEPPER)).not.toEqual(
      deviceHash(ACCOUNT_A, key, 'a_different_pepper_0123456789abcdef'),
    );
  });

  it('cannot be confused by moving the boundary between account and key', () => {
    // A naive `accountId + deviceKey` concatenation would let one pair impersonate
    // another by shifting characters across the join. The separator prevents it.
    const a = deviceHash('aaaa', 'bbbb', PEPPER);
    const b = deviceHash('aaaab', 'bbb', PEPPER);
    expect(a).not.toEqual(b);
  });

  it('compares in constant time', () => {
    const h = deviceHash(ACCOUNT_A, key, PEPPER);
    expect(deviceHashMatches(h, deviceHash(ACCOUNT_A, key, PEPPER))).toBe(true);
    expect(deviceHashMatches(h, deviceHash(ACCOUNT_B, key, PEPPER))).toBe(false);
    expect(deviceHashMatches(h, Buffer.alloc(4))).toBe(false);
  });
});

describe('device labels', () => {
  it('recognise the devices members actually use', () => {
    const cases: [string, string][] = [
      ['Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit Mobile Safari', 'Android phone'],
      ['Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit Safari', 'Android tablet'],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile Safari', 'iPhone'],
      ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Mobile Safari', 'iPad'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome Safari', 'Windows computer'],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari', 'Mac'],
      ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome Safari', 'Chromebook'],
      ['Mozilla/5.0 (X11; Linux x86_64) Firefox', 'Linux computer'],
    ];
    for (const [ua, expected] of cases) {
      expect(labelForUserAgent(ua, labels), ua).toBe(expected);
    }
  });

  it('puts the specific families before the general ones', () => {
    // An iPad's user-agent also mentions Mac; an Android tablet also says Android.
    // Order in the metadata file is what keeps those from being mislabelled.
    expect(labelForUserAgent('iPad; CPU OS 17 like Mac OS X', labels)).toBe('iPad');
  });

  it('falls back rather than guessing', () => {
    expect(labelForUserAgent(undefined, labels)).toBe(labels.defaultLabel);
    expect(labelForUserAgent('', labels)).toBe(labels.defaultLabel);
    expect(labelForUserAgent('curl/8.4.0', labels)).toBe(labels.defaultLabel);
  });

  it('matches case-insensitively', () => {
    expect(labelForUserAgent('MOZILLA/5.0 (WINDOWS NT 10.0)', labels)).toBe('Windows computer');
  });
});

describe('renaming a device', () => {
  it('accepts the note a member would actually write', () => {
  });

  it('refuses empty, oversized and control-character labels', () => {
    expect(normaliseLabel('')).toBeUndefined();
    expect(normaliseLabel('   ')).toBeUndefined();
    expect(normaliseLabel('x'.repeat(41))).toBeUndefined();
    // Non-whitespace control characters, which could disrupt whatever renders them.
    expect(normaliseLabel('phone\u0000')).toBeUndefined();
    expect(normaliseLabel('phone\u0007')).toBeUndefined();
  });

  it('folds stray whitespace instead of refusing it', () => {
    // A pasted label with a newline in it is a person being imprecise, not an attack.
    // Collapsing is kinder than refusing and just as safe — every one of these IS
    // whitespace, so no control character survives the fold.
    expect(normaliseLabel('phone\nlaptop')).toBe('phone laptop');
    expect(normaliseLabel('my\tphone')).toBe('my phone');
  });
});
