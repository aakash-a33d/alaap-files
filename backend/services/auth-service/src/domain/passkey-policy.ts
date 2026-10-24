/**
 * Passkey policy. Pure — the Alaap-specific decisions, not the WebAuthn mechanics.
 *
 * The cryptography lives in @simplewebauthn/server. What lives here is the set of
 * choices that are ours to make, and each one below is a privacy decision as much as
 * a security one.
 *
 * PASSKEYS ARE PREFERRED, NOT REQUIRED (§12M).
 *
 * A passkey is stored in the device's credential manager against the relying party
 * id, so anyone who opens that manager sees that this platform has an account. On a
 * platform whose users' stated fear is being found by family, that is a real cost,
 * and it is not one the product may impose. OTP login stays available, and the
 * enrolment screen has to say plainly what a passkey puts on the device — offering
 * a security upgrade while concealing its disclosure would be the wrong trade made
 * silently.
 */

import type { SessionActorRole } from '@alaap/shared-types';

/** Five minutes. Long enough for a fingerprint prompt, short enough to bound replay. */
export const CHALLENGE_TTL_SECONDS = 300;

/** A member may hold several — a phone, a laptop, a hardware key. */
export const MAX_CREDENTIALS_PER_ACCOUNT = 10;

export interface PasskeyPolicy {
  /**
   * `required` forces a PIN or biometric on the authenticator itself, so a stolen
   * unlocked device cannot silently authenticate.
   */
  userVerification: 'required' | 'preferred';
  /**
   * `none` means the authenticator sends no attestation statement, and the platform
   * learns nothing about its make or model.
   */
  attestation: 'none' | 'direct';
  /**
   * A discoverable credential lets someone sign in WITHOUT first typing a phone
   * number — which matters here beyond convenience: typing a number into a login form
   * is an identity disclosure, and a pseudonymous platform should not require one to
   * get back in.
   */
  residentKey: 'required' | 'preferred';
}

/**
 * Policy by role.
 *
 * Members get privacy-preserving defaults. Staff and therapists get the stricter
 * settings the SQL comment on `passkey_credentials` already anticipates — they act on
 * other people's records, and attestation is worth the fingerprint when the
 * alternative is an unattested authenticator holding clinical access.
 */
export function policyFor(role: SessionActorRole): PasskeyPolicy {
  switch (role) {
    case 'therapist':
    case 'moderator':
    case 'admin':
    case 'safety_reviewer':
      return { userVerification: 'required', attestation: 'direct', residentKey: 'required' };
    case 'user':
    case 'partner':
      // `attestation: 'none'` deliberately. A direct attestation identifies the
      // authenticator model, which is a device fingerprint attached to a mental
      // health account — a worse trade than the assurance it buys for a member.
      return { userVerification: 'preferred', attestation: 'none', residentKey: 'preferred' };
  }
}

/**
 * What the operating system's passkey picker displays.
 *
 * NEVER the phone number, and never anything from the identity vault. The public
 * handle is pseudonymous and recognisable, which is exactly what this field needs.
 *
 * Handles are permanent, so this never goes stale — what the picker shows at the
 * next sign-in is what the member is called in the feed. That is the quiet benefit
 * of giving up rotation: the name on the credential and the name on the posts are
 * the same name, for good.
 */
export function credentialDisplayName(handle: string): string {
  return handle;
}

export type CloneCheck =
  | { ok: true }
  | { ok: false; reason: 'counter_regressed' };

/**
 * Signature counter check — the only clone detection WebAuthn offers.
 *
 * An authenticator increments a counter on every assertion. If a counter arrives
 * lower than or equal to the one already stored, either the authenticator was cloned
 * or an old assertion is being replayed. Both are refusals.
 *
 * MANY AUTHENTICATORS REPORT ZERO ALWAYS — notably platform authenticators backed by
 * iCloud Keychain and Google Password Manager, because a credential that legitimately
 * exists on several devices cannot keep one counter. A permanent zero is therefore
 * normal and must not be treated as an attack; only a genuine regression counts.
 */
export function checkSignCount(stored: number, presented: number): CloneCheck {
  if (stored === 0 && presented === 0) return { ok: true };
  if (presented === 0) return { ok: true };
  if (presented <= stored) return { ok: false, reason: 'counter_regressed' };
  return { ok: true };
}

/**
 * Whether a credential may still be used.
 *
 * Revocation is a timestamp rather than a delete, so that a credential revoked after
 * a suspected compromise stays visible in the account's device list and in any later
 * incident review.
 */
export function isUsable(credential: { revokedAt: string | null }): boolean {
  return credential.revokedAt === null;
}

/**
 * Relying party id. The registrable domain, never the full origin.
 *
 * Getting this wrong is the classic WebAuthn deployment failure: an rpId that does
 * not match the origin's registrable suffix makes every credential unusable, and the
 * browser error says very little about why.
 */
export function deriveRpId(origin: string): string {
  const { hostname } = new URL(origin);
  return hostname;
}
