/* ============================================================================
   Getting in.

   Four doors, and they are deliberately not equivalent:

     register      mobile → OTP → account, handle and recovery codes
     OTP sign-in   mobile → OTP
     recovery      handle + a one-time code, no OTP at all
     passkey       the device proves it

   Recovery exists because the other three all route through a phone number, and
   somebody who has lost the phone is exactly the person who most needs to get
   back in. It is the one door that does not depend on the SIM.

   NOTHING HERE RETURNS A TOKEN TO THE CALLER.

   The responses do carry one — the dev scripts and a future native client use it
   — but the browser never touches it. The gateway turns it into an HttpOnly
   cookie on the way past, so these functions return only what the UI must
   actually render. Passing the token around here would recreate exactly the
   XSS-exfiltratable credential the cookie exists to avoid.
   ========================================================================= */

import { api } from '../../../lib/api/client'

/** Sent for a challenge. The code is in `devCode` only in development. */
export type Challenge = {
  challengeId: string
  /** Development convenience. Absent in deployment, where the SMS carries it. */
  devCode?: string
}

export type Registered = {
  handle: string
  pseudoId: number
  /**
   * Shown once and never again.
   *
   * The server cannot reproduce them — only their hashes are stored — so a
   * member who closes the screen without keeping them has lost that door. The
   * UI must treat this as a step to complete, not a notice to dismiss.
   */
  recoveryCodes: string[]
}

export type SignedIn = {
  handle: string
  pseudoId: number
}

/* ------------------------------------------------------------ register -- */

export async function registerStart(mobile: string): Promise<Challenge> {
  return api.post<Challenge>('/api/auth/register/start', { mobile })
}

/**
 * Finish registering.
 *
 * `ageConfirmed` is required by the server and is not a checkbox the client may
 * default to true. It is the member's own assertion, and the screen must ask.
 */
export async function registerVerify(input: {
  challengeId: string
  code: string
  ageConfirmed: boolean
}): Promise<Registered> {
  return api.post<Registered>('/api/auth/register/verify', input)
}

/* --------------------------------------------------------------- OTP --- */

/**
 * Ask for a sign-in code.
 *
 * Answers 202 with a challenge for an unregistered number exactly as it does for
 * a registered one. That is not an oversight to tidy up: distinguishing them
 * would turn this endpoint into a way to ask "does this person have an account
 * on a mental health platform", which is a question no stranger gets to ask.
 */
export async function loginOtpStart(mobile: string): Promise<Challenge> {
  return api.post<Challenge>('/api/auth/login/otp/start', { mobile })
}

export async function loginOtpVerify(input: {
  challengeId: string
  code: string
}): Promise<SignedIn> {
  return api.post<SignedIn>('/api/auth/login/otp/verify', input)
}

/* ---------------------------------------------------------- recovery --- */

/**
 * Sign in with a recovery code.
 *
 * Handle plus code, and no phone involved. Each code is single-use; spending one
 * is what makes it safe to have written it on paper.
 */
export async function recover(input: {
  handle: string
  recoveryCode: string
}): Promise<SignedIn> {
  return api.post<SignedIn>('/api/auth/recover', input)
}

/**
 * Replace the whole set.
 *
 * Needs a live session — the old codes are not accepted as authorisation for
 * this, or a single stolen code would be enough to lock the real member out.
 */
export async function regenerateRecoveryCodes(): Promise<{ recoveryCodes: string[] }> {
  return api.post<{ recoveryCodes: string[] }>('/api/account/recovery-codes/regenerate')
}
