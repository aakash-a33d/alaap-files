/**
 * packages/service-auth
 *
 * The gateway signs the identity headers; every service verifies them. One
 * implementation, because the signing and the verifying must agree byte for byte —
 * and a mismatch fails open in the worst possible way if a service decides the
 * signature is "probably fine".
 *
 * WHAT THIS PROTECTS
 *
 * Downstream services trust `x-alaap-*` to say who is calling, because the gateway is
 * the only thing permitted to set them and strips any the client sent. That trust is
 * what this signature establishes: a service can confirm the headers came from the
 * gateway and were not altered in transit, and can refuse a request that reached it
 * directly rather than through the front door.
 *
 * WHAT IT DOES NOT PROTECT
 *
 * The body. That is the caller's and the service validates it independently. What
 * needs integrity protection is the gateway's assertion about *who* is calling.
 *
 * MVP MECHANISM. A shared secret distributed to fifteen services is a weaker boundary
 * than the network segment it is meant to protect, so mTLS between deployables should
 * replace this before the identity vault holds real records. Recorded as an open item
 * in ADR-0004 (to be written).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-alaap-service-auth';

/**
 * Anything with `x-alaap-*` keys. What sign and verify actually operate on.
 *
 * Wider than ServiceAuthHeaders on purpose: the canonical form is built from the
 * fields that are PRESENT, so a verifier can cover a header added after it was last
 * deployed without having a name for it.
 */
export type SignableHeaders = Readonly<Record<string, string | undefined>>;

/**
 * The fields the gateway sets and this version can read back into VerifiedCaller.
 *
 * Adding one is no longer a synchronised redeploy - see canonicalise. A service on
 * older code still verifies the new field correctly; it just cannot name it yet.
 */
export interface ServiceAuthHeaders {
  'x-alaap-request-id': string;
  'x-alaap-actor-role': string;
  'x-alaap-purpose': string;
  'x-alaap-issued-at': string;
  'x-alaap-pseudo-id'?: string;
  'x-alaap-session-id'?: string;
  'x-alaap-stepped-up-scope'?: string;
  /**
   * The trusted device this session was created on, when it has one.
   *
   * Carried so a service can say "this device" in a list, and so "sign out everywhere
   * else" knows which one to keep. Signed like the rest: a client that could set it
   * would be able to spare its own session from exactly that action.
   */
  'x-alaap-device-id'?: string;

  /**
   * Fields added after this version was built.
   *
   * Signed and verified like the named ones - canonicalise covers whatever is
   * present - they simply have no home in VerifiedCaller until this file catches up.
   * The index signature is also what makes this assignable to SignableHeaders.
   */
  [key: string]: string | undefined;
}

/**
 * Canonical form: every present `x-alaap-*` field, sorted by name, `key:value` per line.
 *
 * Sorting matters - object key order is not a contract, and a verifier reconstructing
 * from an HTTP header bag has no idea what order the signer used.
 *
 * WHY THIS IS DRIVEN BY WHAT IS PRESENT, NOT BY A FIXED LIST
 *
 * It used to walk SIGNED_KEYS. That made adding one header a synchronised redeploy of
 * every service at once: a gateway signing a field that its callee's copy of this file
 * had never heard of produced two different canonical strings, so EVERY request failed
 * its signature - and from the service's side that is indistinguishable from an
 * attack. Found exactly that way when `x-alaap-device-id` was added.
 *
 * Signing what is present is still sound. An attacker who adds a header changes the
 * canonical string; one who removes a header changes it too; either way the signature
 * stops verifying. What changes is only that a field added later is covered
 * automatically by both sides, so a service running older code verifies it correctly
 * instead of rejecting every caller until it is redeployed.
 */
function canonicalise(headers: SignableHeaders): string {
  return Object.entries(headers)
    .filter(([k, v]) => v !== undefined && k.startsWith('x-alaap-') && k !== SIGNATURE_HEADER)
    .map(([k, v]) => `${k}:${String(v)}`)
    .sort()
    .join('\n');
}

export function sign(headers: SignableHeaders, secret: string): string {
  return createHmac('sha256', secret).update(canonicalise(headers), 'utf8').digest('base64url');
}

export function verify(
  headers: SignableHeaders,
  signature: string,
  secret: string,
): boolean {
  const expected = Buffer.from(sign(headers, secret), 'utf8');
  const actual = Buffer.from(signature, 'utf8');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export interface VerifiedCaller {
  requestId: string;
  actorRole: string;
  purpose: string;
  issuedAt: Date;
  pseudoId?: number;
  sessionId?: string;
  steppedUpScope?: string;
  deviceId?: string;
}

export type VerifyFailure =
  | 'missing_signature'
  | 'missing_headers'
  | 'bad_signature'
  | 'stale_request'
  | 'future_request';

export type VerifyOutcome =
  | { ok: true; caller: VerifiedCaller }
  | { ok: false; reason: VerifyFailure };

/**
 * Five minutes. The signature has no nonce, so a captured request is replayable
 * within the window — bounding it is what keeps that from being indefinite.
 *
 * A real nonce store is the correct fix and needs Redis in every service. Deferred
 * with mTLS, which removes the problem rather than bounding it.
 */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;

/**
 * Verify an incoming request's identity headers.
 *
 * Takes a plain header bag so it works with Express, Fastify or a raw handler, and
 * so it can be tested without an HTTP server.
 */
export function verifyRequest(
  raw: Record<string, string | string[] | undefined>,
  secret: string,
  now: Date = new Date(),
): VerifyOutcome {
  const get = (name: string): string | undefined => {
    const v = raw[name];
    return Array.isArray(v) ? v[0] : v;
  };

  const signature = get(SIGNATURE_HEADER);
  if (signature === undefined) return { ok: false, reason: 'missing_signature' };

  const requestId = get('x-alaap-request-id');
  const actorRole = get('x-alaap-actor-role');
  const purpose = get('x-alaap-purpose');
  const issuedAt = get('x-alaap-issued-at');
  if (
    requestId === undefined ||
    actorRole === undefined ||
    purpose === undefined ||
    issuedAt === undefined
  ) {
    return { ok: false, reason: 'missing_headers' };
  }

  // Rebuilt from EVERY x-alaap-* header present, not from a list of the ones this
  // version knows. That is what lets a service verify a request carrying a field
  // added after it was last deployed: the signer covered it, so the verifier must
  // too, or the two canonical strings differ and every request fails.
  //
  // Still strict in both directions - a header added, altered or stripped in transit
  // changes the canonical string and breaks the signature.
  const headers = {} as Record<string, string>;
  for (const name of Object.keys(raw)) {
    const lower = name.toLowerCase();
    if (!lower.startsWith('x-alaap-') || lower === SIGNATURE_HEADER) continue;
    const value = get(name);
    if (value !== undefined) headers[lower] = value;
  }

  const pseudoId = get('x-alaap-pseudo-id');
  const sessionId = get('x-alaap-session-id');
  const steppedUpScope = get('x-alaap-stepped-up-scope');
  const deviceId = get('x-alaap-device-id');

  // Signature before freshness: an attacker must not be able to learn anything from
  // the difference between "wrongly signed" and "correctly signed but stale".
  if (!verify(headers, signature, secret)) {
    return { ok: false, reason: 'bad_signature' };
  }

  const issued = Date.parse(issuedAt);
  if (!Number.isFinite(issued)) return { ok: false, reason: 'missing_headers' };
  const drift = now.getTime() - issued;
  if (drift > MAX_CLOCK_SKEW_MS) return { ok: false, reason: 'stale_request' };
  if (drift < -MAX_CLOCK_SKEW_MS) return { ok: false, reason: 'future_request' };

  const caller: VerifiedCaller = { requestId, actorRole, purpose, issuedAt: new Date(issued) };
  if (pseudoId !== undefined) {
    const n = Number(pseudoId);
    if (Number.isSafeInteger(n)) caller.pseudoId = n;
  }
  if (sessionId !== undefined) caller.sessionId = sessionId;
  if (steppedUpScope !== undefined) caller.steppedUpScope = steppedUpScope;
  if (deviceId !== undefined) caller.deviceId = deviceId;

  return { ok: true, caller };
}
