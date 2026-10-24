/**
 * Identifier generation. Pure — zero I/O, zero imports from infrastructure.
 *
 * These are the values that follow a person across every vault, so how they are
 * generated is a privacy decision rather than a convenience one.
 */

import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * A pseudonymous id.
 *
 * RANDOM, NOT SEQUENTIAL, and that is the whole point. `pseudo_id` is the join key
 * across every vault and appears in audit rows, so a sequential value would leak
 * registration order — telling anyone holding two ids which person joined first, and
 * roughly how many members exist. A `bigserial` here would have been the obvious
 * choice and the wrong one.
 *
 * 52 bits, which fits a JavaScript safe integer and a PostgreSQL bigint without
 * either truncating. Collision probability stays negligible well past any plausible
 * user count, and the caller retries on the unique constraint regardless.
 */
export function generatePseudoId(): number {
  // Two 26-bit halves, because randomInt caps at 2^48.
  const high = randomInt(0, 2 ** 26);
  const low = randomInt(0, 2 ** 26);
  const value = high * 2 ** 26 + low;
  // Never zero, and never small enough to look like a test fixture in a log.
  return value < 100_000 ? value + 100_000 : value;
}

/**
 * Blind index over a verified mobile number: HMAC(pepper, E.164).
 *
 * Answers "does an account exist for this number" without storing anything
 * reversible. The pepper lives in the KMS, so a database dump alone cannot be
 * dictionary-attacked — and a phone number space is small enough that a plain hash
 * would be enumerable in minutes.
 *
 * The same value is computed independently by identity-vault-service, which is how
 * the two instances reconcile an account without either learning the number from the
 * other.
 */
export function mobileLookupHash(e164: string, pepper: string): Buffer {
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) {
    throw new Error('mobileLookupHash requires an E.164 number');
  }
  return createHmac('sha256', pepper).update(e164, 'utf8').digest();
}

/**
 * Normalise an Indian mobile number to E.164.
 *
 * Deliberately narrow: this accepts Indian numbers and nothing else, because
 * accepting a number the platform cannot send an OTP to produces an account that can
 * never authenticate. International support arrives with the market that needs it.
 */
export function normaliseIndianMobile(input: string): string | undefined {
  const cleaned = input.replace(/[\s()\-.]/g, '');

  // Dispatch on LENGTH, not on a leading-prefix regex.
  //
  // Stripping `^(\+91|91|0091|0)` looks obvious and is wrong: a valid ten-digit
  // number beginning 91 — every 91xxxxxxxx subscriber, which is a large share of
  // them — has its first two digits eaten as a country code and is then rejected as
  // too short. Length disambiguates where a prefix match cannot.
  const candidates: string[] = [];
  if (/^\+91\d{10}$/.test(cleaned)) candidates.push(cleaned.slice(3));
  else if (/^0091\d{10}$/.test(cleaned)) candidates.push(cleaned.slice(4));
  else if (/^91\d{10}$/.test(cleaned)) candidates.push(cleaned.slice(2));
  else if (/^0\d{10}$/.test(cleaned)) candidates.push(cleaned.slice(1));
  else if (/^\d{10}$/.test(cleaned)) candidates.push(cleaned);

  const bare = candidates[0];
  // Indian mobile numbers are ten digits beginning 6-9.
  if (bare === undefined || !/^[6-9]\d{9}$/.test(bare)) return undefined;
  return `+91${bare}`;
}

export interface RecoveryCodeBundle {
  /** Shown to the user exactly once. Never stored in this form. */
  plaintext: string[];
  /** What goes in the database. */
  hashes: Buffer[];
  generation: number;
}

/**
 * Single-use recovery codes.
 *
 * Ten codes, each 10 characters from an unambiguous alphabet — no 0/O, no 1/I/L —
 * because these get written on paper and read back over a phone line by someone who
 * has already lost their device and is not having a good day.
 *
 * Recovery restores access to the account. It does NOT restore Maximum Privacy Mode
 * records: their key never left the lost device, and the recovery screen has to say
 * so rather than implying otherwise.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateRecoveryCodes(generation = 1, count = 10): RecoveryCodeBundle {
  const plaintext: string[] = [];
  for (let i = 0; i < count; i += 1) {
    let code = '';
    for (let j = 0; j < 10; j += 1) {
      code += ALPHABET[randomInt(0, ALPHABET.length)];
    }
    plaintext.push(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return {
    plaintext,
    hashes: plaintext.map((c) => hashRecoveryCode(c)),
    generation,
  };
}

/**
 * Recovery codes are hashed, not peppered-HMAC'd like the mobile index, because they
 * carry 50 bits of entropy from a 31-character alphabet — there is no dictionary to
 * attack. The mobile number needs a pepper precisely because its space is tiny.
 */
export function hashRecoveryCode(code: string): Buffer {
  const normalised = code.toUpperCase().replace(/[^A-Z2-9]/g, '');
  return createHmac('sha256', 'alaap-recovery-code-v1').update(normalised, 'utf8').digest();
}

export function recoveryCodeMatches(candidate: string, stored: Buffer): boolean {
  const computed = hashRecoveryCode(candidate);
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}

/** Opaque handle for a multi-step registration, so the client holds no state. */
export function generateChallengeId(): string {
  return `chal_${randomBytes(16).toString('base64url')}`;
}
