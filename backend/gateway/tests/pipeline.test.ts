/**
 * The behaviours that make this a privacy gateway rather than a reverse proxy.
 *
 * Each of these corresponds to a rule in the architecture documents, and each would
 * be a real vulnerability if it regressed.
 */

import { describe, expect, it, vi } from 'vitest';

import { actionTypeFor, isPolicyDenial, shouldAudit } from '../src/audit/middleware.ts';
import { classify } from '../src/policies/consent/index.ts';
import { truncateIp } from '../src/middleware/request-context.ts';
import { signHeaders, verifyHeaders, type ServiceAuthHeaders } from '../src/routes/proxy.ts';
import { SessionStore, STEP_UP_LIFETIME_MS, hashToken } from '../src/infrastructure/session-store.ts';
import type { SessionRecord } from '../src/types.ts';

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const now = Date.now();
  return {
    sessionId: 'ses_1',
    accountId: 'acc_1',
    pseudoId: 847291,
    actorRole: 'user',
    createdAt: new Date(now - 60_000).toISOString(),
    lastActiveAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 1_800_000).toISOString(),
    absoluteExpiresAt: new Date(now + 86_400_000).toISOString(),
    ...overrides,
  };
}

describe('session tokens', () => {
  it('never stores the token itself', () => {
    const hash = hashToken('opaque-token-value');
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain('opaque');
  });

  it('drops an expired session and does not slide it back to life', async () => {
    const expired = session({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const del = vi.fn().mockResolvedValue(1);
    const redis = {
      get: vi.fn().mockResolvedValue(JSON.stringify(expired)),
      set: vi.fn(),
      del,
    };

    const store = new SessionStore(redis as never, 720);
    await expect(store.resolve('tok')).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledOnce();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('never slides past the absolute expiry', async () => {
    const nearlyDone = session({
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 5_000).toISOString(),
    });
    const set = vi.fn().mockResolvedValue('OK');
    const redis = {
      get: vi.fn().mockResolvedValue(JSON.stringify(nearlyDone)),
      set,
      del: vi.fn(),
    };

    const store = new SessionStore(redis as never, 720);
    const result = await store.resolve('tok');
    expect(result).toBeDefined();
    expect(result!.ttlSeconds).toBeLessThanOrEqual(5);
  });
});

describe('step-up assertions', () => {
  it('requires a scope that matches the group', () => {
    const record = session({
      steppedUpAt: new Date().toISOString(),
      steppedUpScope: '/api/billing',
    });
    // A step-up taken to change a payment method must not unlock break-glass.
    expect(SessionStore.hasStepUp(record, '/api/break-glass')).toBe(false);
    expect(SessionStore.hasStepUp(record, '/api/billing')).toBe(true);
  });

  it('expires sooner than the session', () => {
    const record = session({
      steppedUpAt: new Date(Date.now() - STEP_UP_LIFETIME_MS - 1000).toISOString(),
      steppedUpScope: '/api/admin',
    });
    expect(SessionStore.hasStepUp(record, '/api/admin')).toBe(false);
  });

  it('treats a scopeless assertion as covering nothing', () => {
    const record = session({ steppedUpAt: new Date().toISOString() });
    expect(SessionStore.hasStepUp(record, '/api/admin')).toBe(false);
  });
});

describe('service authorization', () => {
  const secret = 'a-test-secret-that-is-long-enough-to-pass';

  const headers: ServiceAuthHeaders = {
    'x-alaap-request-id': 'req-1',
    'x-alaap-actor-role': 'user',
    'x-alaap-purpose': 'community-moderation',
    'x-alaap-issued-at': '2026-09-07T00:00:00.000Z',
    'x-alaap-pseudo-id': '847291',
  };

  it('verifies its own signature', () => {
    expect(verifyHeaders(headers, signHeaders(headers, secret), secret)).toBe(true);
  });

  it('rejects a tampered pseudo id', () => {
    const signature = signHeaders(headers, secret);
    const forged: ServiceAuthHeaders = { ...headers, 'x-alaap-pseudo-id': '999999' };
    expect(verifyHeaders(forged, signature, secret)).toBe(false);
  });

  it('rejects a tampered role', () => {
    const signature = signHeaders(headers, secret);
    const forged: ServiceAuthHeaders = { ...headers, 'x-alaap-actor-role': 'admin' };
    expect(verifyHeaders(forged, signature, secret)).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    expect(verifyHeaders(headers, signHeaders(headers, 'other-secret-value-here'), secret)).toBe(
      false,
    );
  });
});

describe('ip truncation', () => {
  it('keeps only a /24 of an IPv4 address', () => {
    expect(truncateIp('203.0.113.42')).toBe('203.0.113.0/24');
  });

  it('keeps only a /48 of an IPv6 address', () => {
    expect(truncateIp('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3::/48');
  });

  it('takes the first hop of a forwarded chain', () => {
    expect(truncateIp('198.51.100.7, 203.0.113.1')).toBe('198.51.100.0/24');
  });
});

describe('audit selection', () => {
  it('audits nothing when the group says none', () => {
    expect(shouldAudit('none', 'POST')).toBe(false);
    expect(shouldAudit('none', 'GET')).toBe(false);
  });

  it('audits only mutations when the group says writes', () => {
    expect(shouldAudit('writes', 'GET')).toBe(false);
    expect(shouldAudit('writes', 'POST')).toBe(true);
    expect(shouldAudit('writes', 'DELETE')).toBe(true);
  });

  it('audits reads too when the read is the sensitive act', () => {
    expect(shouldAudit('all', 'GET')).toBe(true);
  });

  it('derives a stable action type', () => {
    expect(actionTypeFor('/api/community', 'POST')).toBe('gateway.community.create');
    expect(actionTypeFor('/api/break-glass', 'GET')).toBe('gateway.break_glass.read');
  });
});

describe('one audit row per request', () => {
  // Regression: a request audited as allowed at stage 8, which then 502s because the
  // upstream is down, was writing a SECOND row saying consent_decision 'denied' and
  // access_result 'denied'. The gateway denied nothing — it allowed the request and
  // the upstream was unreachable. An audit vault is the one store where a false row
  // can never be corrected, so this must not be approximately right.
  it('treats a policy refusal as a denial', () => {
    expect(isPolicyDenial(401)).toBe(true); // no session
    expect(isPolicyDenial(403)).toBe(true); // step-up required
    expect(isPolicyDenial(404)).toBe(true); // role not permitted
    expect(isPolicyDenial(429)).toBe(true); // rate limited
    expect(isPolicyDenial(400)).toBe(true); // caller supplied its own purpose
  });

  it('does not treat an infrastructure failure as a denial', () => {
    expect(isPolicyDenial(502)).toBe(false); // upstream unreachable
    expect(isPolicyDenial(503)).toBe(false); // audit vault or Redis unavailable
    expect(isPolicyDenial(504)).toBe(false); // upstream timeout
    expect(isPolicyDenial(500)).toBe(false); // internal error
  });
});

describe('coarse consent classification', () => {
  it('marks a not-required purpose as such', () => {
    expect(
      classify({
        id: 'community-moderation',
        label: '',
        vaults: ['community'],
        consent: 'not-required',
        basis: 'legitimate-safety',
        ai_permitted: true,
      }),
    ).toBe('not_required');
  });

  it('marks an override purpose as override, never as granted', () => {
    // emergency-contact-disclosure proceeds against a stated preference. Recording
    // it as "granted" would make the audit trail claim consent that was not given.
    expect(
      classify({
        id: 'emergency-contact-disclosure',
        label: '',
        vaults: ['identity'],
        consent: 'override',
        basis: 'vital-interest',
        ai_permitted: false,
      }),
    ).toBe('override');
  });

  it('requires nothing when no purpose is declared', () => {
    expect(classify(undefined)).toBe('not_required');
  });
});
