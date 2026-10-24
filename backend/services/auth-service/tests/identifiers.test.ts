import { describe, expect, it } from 'vitest';

import {
  generatePseudoId,
  generateRecoveryCodes,
  hashRecoveryCode,
  mobileLookupHash,
  normaliseIndianMobile,
  recoveryCodeMatches,
} from '../src/domain/identifiers.ts';

describe('mobile normalisation', () => {
  it('accepts a bare ten-digit number', () => {
    expect(normaliseIndianMobile('9876543210')).toBe('+919876543210');
  });

  it('accepts a number that BEGINS with 91', () => {
    // Regression. A prefix-stripping regex ate the leading 91 as a country code and
    // rejected the number as too short — which is every 91xxxxxxxx subscriber, a
    // large share of them.
    expect(normaliseIndianMobile('9123456780')).toBe('+919123456780');
    expect(normaliseIndianMobile('9198765432')).toBe('+919198765432');
  });

  it('accepts the usual prefixes and separators', () => {
    expect(normaliseIndianMobile('+91 98765 43210')).toBe('+919876543210');
    expect(normaliseIndianMobile('0091-9876543210')).toBe('+919876543210');
    expect(normaliseIndianMobile('919876543210')).toBe('+919876543210');
    expect(normaliseIndianMobile('09876543210')).toBe('+919876543210');
    expect(normaliseIndianMobile('(987) 654-3210')).toBe('+919876543210');
  });

  it('refuses what cannot receive an OTP', () => {
    // An account on a number the platform cannot text can never authenticate, so
    // accepting one is worse than refusing it.
    expect(normaliseIndianMobile('1234567890')).toBeUndefined(); // starts 1
    expect(normaliseIndianMobile('5876543210')).toBeUndefined(); // starts 5
    expect(normaliseIndianMobile('98765432')).toBeUndefined(); // too short
    expect(normaliseIndianMobile('98765432101')).toBeUndefined(); // too long
    expect(normaliseIndianMobile('+14155552671')).toBeUndefined(); // not Indian
    expect(normaliseIndianMobile('')).toBeUndefined();
  });
});

describe('mobile blind index', () => {
  it('is stable for the same number and pepper', () => {
    const a = mobileLookupHash('+919876543210', 'pepper-value-long-enough');
    const b = mobileLookupHash('+919876543210', 'pepper-value-long-enough');
    expect(a.equals(b)).toBe(true);
  });

  it('differs under a different pepper', () => {
    // Which is why rotating MOBILE_PEPPER re-indexes every account.
    const a = mobileLookupHash('+919876543210', 'pepper-one-long-enough-yes');
    const b = mobileLookupHash('+919876543210', 'pepper-two-long-enough-yes');
    expect(a.equals(b)).toBe(false);
  });

  it('refuses anything that is not E.164', () => {
    expect(() => mobileLookupHash('9876543210', 'pepper-value-long-enough')).toThrow();
  });
});

describe('pseudo_id', () => {
  it('is random rather than sequential', () => {
    // Sequential ids would leak registration order to anyone holding two of them,
    // and roughly how many members exist. A bigserial here would be the obvious
    // choice and the wrong one.
    const ids = Array.from({ length: 500 }, () => generatePseudoId());
    expect(new Set(ids).size).toBe(500);

    const sorted = [...ids].sort((a, b) => a - b);
    expect(ids).not.toEqual(sorted);
  });

  it('stays inside a safe integer and a bigint', () => {
    for (let i = 0; i < 500; i += 1) {
      const id = generatePseudoId();
      expect(Number.isSafeInteger(id)).toBe(true);
      expect(id).toBeGreaterThan(99_999);
    }
  });
});

describe('recovery codes', () => {
  it('issues ten single-use codes', () => {
    const bundle = generateRecoveryCodes();
    expect(bundle.plaintext).toHaveLength(10);
    expect(bundle.hashes).toHaveLength(10);
    expect(new Set(bundle.plaintext).size).toBe(10);
  });

  it('uses an alphabet with no ambiguous characters', () => {
    // These get written on paper and read back down a phone line by someone who has
    // already lost their device.
    const bundle = generateRecoveryCodes();
    for (const code of bundle.plaintext) {
      expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      expect(code).not.toMatch(/[OIL01]/);
    }
  });

  it('verifies a code case- and separator-insensitively', () => {
    const bundle = generateRecoveryCodes();
    const code = bundle.plaintext[0]!;
    const hash = bundle.hashes[0]!;
    expect(recoveryCodeMatches(code, hash)).toBe(true);
    expect(recoveryCodeMatches(code.toLowerCase(), hash)).toBe(true);
    expect(recoveryCodeMatches(code.replace('-', ''), hash)).toBe(true);
    expect(recoveryCodeMatches(code.replace('-', ' '), hash)).toBe(true);
  });

  it('rejects a wrong code', () => {
    const bundle = generateRecoveryCodes();
    expect(recoveryCodeMatches('AAAAA-BBBBB', bundle.hashes[0]!)).toBe(false);
  });

  it('never stores the plaintext', () => {
    const bundle = generateRecoveryCodes();
    for (let i = 0; i < 10; i += 1) {
      const hash = bundle.hashes[i]!.toString('hex');
      expect(hash).not.toContain(bundle.plaintext[i]!.replace('-', ''));
    }
    expect(hashRecoveryCode('ABCDE-FGHJK')).toHaveLength(32);
  });
});
