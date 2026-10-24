/**
 * The signature is what lets a service trust `x-alaap-*` to say who is calling.
 * Every tamper case below would be an identity-spoofing vulnerability if it passed.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_CLOCK_SKEW_MS,
  SIGNATURE_HEADER,
  sign,
  verify,
  verifyRequest,
  type ServiceAuthHeaders,
} from '../src/index.ts';

const SECRET = 'a-test-secret-long-enough-to-be-plausible';
const NOW = new Date('2026-09-10T12:00:00.000Z');

const headers: ServiceAuthHeaders = {
  'x-alaap-request-id': 'req-1',
  'x-alaap-actor-role': 'user',
  'x-alaap-purpose': 'community-moderation',
  'x-alaap-issued-at': NOW.toISOString(),
  'x-alaap-pseudo-id': '847291',
};

function bag(over: Record<string, string | undefined> = {}) {
  const out: Record<string, string | undefined> = {
    ...headers,
    [SIGNATURE_HEADER]: sign(headers, SECRET),
    ...over,
  };
  return out;
}

describe('signature', () => {
  it('verifies its own output', () => {
    expect(verify(headers, sign(headers, SECRET), SECRET)).toBe(true);
  });

  it('rejects a tampered pseudo id', () => {
    const forged = { ...headers, 'x-alaap-pseudo-id': '999999' };
    expect(verify(forged, sign(headers, SECRET), SECRET)).toBe(false);
  });

  it('rejects a tampered role', () => {
    const forged = { ...headers, 'x-alaap-actor-role': 'admin' };
    expect(verify(forged, sign(headers, SECRET), SECRET)).toBe(false);
  });

  it('rejects a tampered purpose', () => {
    const forged = { ...headers, 'x-alaap-purpose': 'emergency-contact-disclosure' };
    expect(verify(forged, sign(headers, SECRET), SECRET)).toBe(false);
  });

  it('rejects a different secret', () => {
    expect(verify(headers, sign(headers, 'another-secret-entirely-here'), SECRET)).toBe(false);
  });

  it('is insensitive to object key order', () => {
    const reordered: ServiceAuthHeaders = {
      'x-alaap-pseudo-id': '847291',
      'x-alaap-issued-at': NOW.toISOString(),
      'x-alaap-purpose': 'community-moderation',
      'x-alaap-actor-role': 'user',
      'x-alaap-request-id': 'req-1',
    };
    expect(sign(reordered, SECRET)).toBe(sign(headers, SECRET));
  });
});

describe('verifyRequest', () => {
  it('accepts a well-formed request and returns the caller', () => {
    const out = verifyRequest(bag(), SECRET, NOW);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.caller.pseudoId).toBe(847291);
      expect(out.caller.actorRole).toBe('user');
      expect(out.caller.purpose).toBe('community-moderation');
    }
  });

  it('refuses a request with no signature — the direct-hit case', () => {
    const b = bag();
    delete b[SIGNATURE_HEADER];
    const out = verifyRequest(b, SECRET, NOW);
    expect(out).toEqual({ ok: false, reason: 'missing_signature' });
  });

  it('refuses missing identity headers', () => {
    const b = bag();
    delete b['x-alaap-actor-role'];
    expect(verifyRequest(b, SECRET, NOW)).toEqual({ ok: false, reason: 'missing_headers' });
  });

  it('refuses a bad signature before considering freshness', () => {
    // An attacker must learn nothing from the difference between "wrongly signed"
    // and "correctly signed but stale".
    const stale = new Date(NOW.getTime() - MAX_CLOCK_SKEW_MS - 60_000).toISOString();
    const b = bag({ 'x-alaap-issued-at': stale });
    expect(verifyRequest(b, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses a correctly signed but stale request', () => {
    const stale = new Date(NOW.getTime() - MAX_CLOCK_SKEW_MS - 60_000).toISOString();
    const h: ServiceAuthHeaders = { ...headers, 'x-alaap-issued-at': stale };
    const b = { ...h, [SIGNATURE_HEADER]: sign(h, SECRET) } as Record<string, string>;
    expect(verifyRequest(b, SECRET, NOW)).toEqual({ ok: false, reason: 'stale_request' });
  });

  it('refuses a request from the future', () => {
    const ahead = new Date(NOW.getTime() + MAX_CLOCK_SKEW_MS + 60_000).toISOString();
    const h: ServiceAuthHeaders = { ...headers, 'x-alaap-issued-at': ahead };
    const b = { ...h, [SIGNATURE_HEADER]: sign(h, SECRET) } as Record<string, string>;
    expect(verifyRequest(b, SECRET, NOW)).toEqual({ ok: false, reason: 'future_request' });
  });

  it('tolerates array-valued headers', () => {
    const b = bag() as Record<string, string | string[] | undefined>;
    b['x-alaap-request-id'] = ['req-1'];
    expect(verifyRequest(b, SECRET, NOW).ok).toBe(true);
  });
});

describe('adding a signed field does not break older services', () => {
  it('covers a header this version has never heard of', () => {
    // The regression that prompted this. canonicalise used to walk a fixed key list,
    // so a gateway signing a field its callee had not been redeployed with produced
    // two different canonical strings and EVERY request failed its signature -
    // indistinguishable, from the service's side, from an attack.
    const headers = { ...bag() } as Record<string, string>;
    delete headers[SIGNATURE_HEADER];
    headers['x-alaap-not-invented-yet'] = 'some-future-value';

    const signature = sign(headers as never, SECRET);
    expect(verifyRequest({ ...headers, [SIGNATURE_HEADER]: signature }, SECRET, NOW).ok).toBe(true);
  });

  it('still refuses a request where that field was altered in transit', () => {
    // Forward compatibility must not become a hole: an unknown field is signed, so
    // changing it has to break the signature exactly like a known one.
    const headers = { ...bag() } as Record<string, string>;
    delete headers[SIGNATURE_HEADER];
    headers['x-alaap-not-invented-yet'] = 'some-future-value';
    const signature = sign(headers as never, SECRET);

    const tampered = { ...headers, 'x-alaap-not-invented-yet': 'tampered' };
    const outcome = verifyRequest({ ...tampered, [SIGNATURE_HEADER]: signature }, SECRET, NOW);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('bad_signature');
  });

  it('and refuses one where it was stripped', () => {
    const headers = { ...bag() } as Record<string, string>;
    delete headers[SIGNATURE_HEADER];
    headers['x-alaap-not-invented-yet'] = 'some-future-value';
    const signature = sign(headers as never, SECRET);

    const stripped = { ...headers };
    delete stripped['x-alaap-not-invented-yet'];
    expect(verifyRequest({ ...stripped, [SIGNATURE_HEADER]: signature }, SECRET, NOW).ok).toBe(false);
  });
});
