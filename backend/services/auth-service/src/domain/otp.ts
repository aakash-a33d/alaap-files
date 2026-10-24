/**
 * One-time passcodes. Pure — the policy, not the delivery.
 *
 * OTP is the SECONDARY authentication method (§12M): passkeys are primary, and OTP
 * exists for registration and for recovery when a device is gone. Building it first
 * is a sequencing choice, not a change of position — passkey registration needs an
 * account to attach to, and an account needs a verified number.
 *
 * TRAI DLT registration gates every OTP the platform can send, takes weeks, and
 * therefore blocks registration and everything behind it. In development the code is
 * logged rather than sent, which is why `OtpChallenge` carries no delivery state at
 * all — the transport is somebody else's problem and must stay that way.
 */

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Six digits, which is what people expect from an Indian OTP and what SMS templates
 * are registered for. Six digits is only a million values, so the attempt limit below
 * is doing the real work — not the code length.
 */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashOtp(code: string, pepper: string): Buffer {
  return createHmac('sha256', pepper).update(code, 'utf8').digest();
}

export function otpMatches(candidate: string, stored: Buffer, pepper: string): boolean {
  const computed = hashOtp(candidate, pepper);
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}

/**
 * FIVE ATTEMPTS, then the challenge is dead.
 *
 * A million possible codes and unlimited attempts is a solved problem for an
 * attacker. Five attempts against a five-minute window is roughly one chance in
 * 200,000 per challenge, and a burnt challenge cannot be retried — a new one has to
 * be requested, which is separately rate-limited.
 */
export const MAX_ATTEMPTS = 5;

/** Long enough to receive an SMS on a bad connection, short enough to bound replay. */
export const CHALLENGE_TTL_SECONDS = 300;

/**
 * Resend cooling-off. Without it, "resend" becomes an SMS-cost amplifier pointed at
 * the platform and a harassment vector pointed at whoever owns the number.
 */
export const RESEND_COOLDOWN_SECONDS = 60;

/** Per number, per hour. Caps both spend and nuisance. */
export const MAX_SENDS_PER_NUMBER_PER_HOUR = 5;

export interface OtpChallenge {
  challengeId: string;
  /** The blind index, not the number. This record never holds a phone number. */
  mobileLookupHash: string;
  codeHash: string;
  attemptsUsed: number;
  createdAt: string;
  expiresAt: string;
  /**
   * What the code was issued for.
   *
   * Checked on verification, so a code texted for one purpose cannot be spent on
   * another. `step_up` in particular must not be replayable as a sign-in: the
   * member already holds a session, and the point of the second factor is that it
   * proves presence NOW, not that it mints a new way in.
   */
  intent: 'register' | 'login' | 'recover' | 'step_up';
  /**
   * Whose challenge this is. Set for `step_up` only.
   *
   * A step-up is raised by somebody already signed in, so the challenge belongs to a
   * known member and verification must confirm the caller is that member. Without it
   * one member could start a step-up and another could spend the code — which is the
   * whole of what the second factor was supposed to prevent.
   *
   * Absent for register, login and recover: at that point there is no session, and
   * the mobile lookup hash is the only binding available.
   */
  pseudoId?: number;
}

export type OtpFailure =
  | 'challenge_not_found'
  | 'challenge_expired'
  | 'too_many_attempts'
  | 'wrong_code'
  | 'intent_mismatch';

export type OtpOutcome =
  | { ok: true }
  | { ok: false; reason: OtpFailure; attemptsRemaining: number };

/**
 * Verify a submitted code against a challenge.
 *
 * Returns the attempt budget so the caller can persist it. Deliberately does not
 * mutate — the caller owns the store, and a pure check is one that can be tested
 * exhaustively.
 */
export function verifyOtp(
  challenge: OtpChallenge,
  submitted: string,
  intent: OtpChallenge['intent'],
  pepper: string,
  now: Date = new Date(),
): OtpOutcome {
  const remaining = Math.max(0, MAX_ATTEMPTS - challenge.attemptsUsed);

  if (Date.parse(challenge.expiresAt) <= now.getTime()) {
    return { ok: false, reason: 'challenge_expired', attemptsRemaining: 0 };
  }
  if (challenge.attemptsUsed >= MAX_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts', attemptsRemaining: 0 };
  }
  // An OTP issued to register must not be replayable to log in or to recover.
  if (challenge.intent !== intent) {
    return { ok: false, reason: 'intent_mismatch', attemptsRemaining: remaining - 1 };
  }
  if (!otpMatches(submitted, Buffer.from(challenge.codeHash, 'base64'), pepper)) {
    return { ok: false, reason: 'wrong_code', attemptsRemaining: remaining - 1 };
  }
  return { ok: true };
}
