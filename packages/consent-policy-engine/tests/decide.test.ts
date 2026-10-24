/**
 * Every denial path in the engine, asserted.
 *
 * This is the point of building the engine as a pure function: each of these is a
 * property the architecture depends on, and each can be checked in microseconds with
 * no database, no fixture and no mock. A rule that is only exercised through an
 * integration test is a rule that gets exercised on one happy path and trusted on
 * the other twenty.
 *
 * The final test asserts that every `Denial` the type declares is actually reachable,
 * so a denial reason cannot be added, forgotten, and left as dead vocabulary.
 */

import { describe, expect, it } from 'vitest';

import { decide } from '../src/decide.ts';
import type {
  AccessRequest,
  ConsentFacts,
  Denial,
  PurposeFacts,
  RecordFacts,
} from '../src/types.ts';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const OWNER = 847291;

const EXPLICIT: PurposeFacts = {
  id: 'therapist-session-prep',
  consent: 'explicit',
  basis: 'consent',
  aiPermitted: true,
  vaults: ['clinical'],
};

const NOT_REQUIRED: PurposeFacts = {
  id: 'community-moderation',
  consent: 'not-required',
  basis: 'legitimate-safety',
  aiPermitted: true,
  vaults: ['community'],
};

const IMPLIED: PurposeFacts = {
  id: 'care-delivery',
  consent: 'implied-by-service',
  basis: 'contract',
  aiPermitted: false,
  vaults: ['clinical', 'billing'],
};

const OVERRIDE: PurposeFacts = {
  id: 'emergency-contact-disclosure',
  consent: 'override',
  basis: 'vital-interest',
  aiPermitted: false,
  vaults: ['identity'],
};

const GRANTED: ConsentFacts = {
  purpose: 'therapist-session-prep',
  state: 'granted',
  grantedAt: new Date('2026-08-01T00:00:00.000Z'),
};

function record(over: Partial<RecordFacts> = {}): RecordFacts {
  return {
    kind: 'journal_entry',
    ownerPseudoId: OWNER,
    visibility: 'private_to_user',
    aiAnalysis: 'not_allowed',
    therapistAccess: false,
    privacyMode: 'standard',
    trainingUse: false,
    ...over,
  };
}

function req(over: Partial<AccessRequest> = {}): AccessRequest {
  return {
    layer: 'service',
    actor: { kind: 'self', pseudoId: OWNER },
    action: 'read',
    record: record(),
    purpose: NOT_REQUIRED,
    now: NOW,
    ...over,
  };
}

const seen = new Set<Denial>();
function expectDenial(r: AccessRequest, denial: Denial) {
  const d = decide(r);
  expect(d.allowed, `expected denial ${denial}`).toBe(false);
  expect(d.denial).toBe(denial);
  seen.add(denial);
  return d;
}

// ---------------------------------------------------------------------------

describe('the owner reading their own record', () => {
  it('is allowed', () => {
    const d = decide(req());
    expect(d.allowed).toBe(true);
    expect(d.consent).toBe('not_required');
    expect(d.denial).toBeNull();
  });

  it('is refused for somebody else’s record', () => {
    expectDenial(req({ actor: { kind: 'self', pseudoId: 999999 } }), 'not_owner');
  });

  it('may still read their own Maximum Privacy record', () => {
    // The device holds the key, so the owner can decrypt locally. Only the platform
    // is locked out, which is the whole design.
    const d = decide(req({ record: record({ privacyMode: 'maximum' }) }));
    expect(d.allowed).toBe(true);
  });
});

describe('Maximum Privacy is structural, not a permission', () => {
  it('locks out a therapist even with perfect consent and relationship', () => {
    const d = expectDenial(
      req({
        actor: { kind: 'therapist', actorId: 'T-982' },
        purpose: EXPLICIT,
        consent: GRANTED,
        care: { therapistId: 'T-982', active: true, scope: 'individual' },
        record: record({
          privacyMode: 'maximum',
          visibility: 'shared_with_therapist',
          therapistAccess: true,
        }),
      }),
      'maximum_privacy_no_platform_key',
    );
    // The distinction the interface has to make: this was never possible, as
    // opposed to having been declined.
    expect(d.structural).toBe(true);
  });

  it('locks out the AI tier entirely', () => {
    expectDenial(
      req({
        actor: { kind: 'ai', serviceId: 'therapist-insight' },
        action: 'analyse',
        purpose: EXPLICIT,
        consent: GRANTED,
        record: record({
          privacyMode: 'maximum',
          aiAnalysis: 'allowed',
          aiPurpose: 'therapist-session-prep',
        }),
      }),
      'maximum_privacy_no_platform_key',
    );
  });

  it('does not block a write, which needs no plaintext', () => {
    const d = decide(
      req({ action: 'write', record: record({ privacyMode: 'maximum' }) }),
    );
    expect(d.allowed).toBe(true);
  });
});

describe('records that are gone, or going', () => {
  it('refuses a record pending purge', () => {
    expectDenial(req({ record: record({ visibility: 'pending_purge' }) }), 'record_pending_purge');
  });

  it('refuses a record whose retention window has closed', () => {
    const d = expectDenial(
      req({ record: record({ retentionUntil: new Date('2026-09-09T00:00:00.000Z') }) }),
      'retention_expired',
    );
    expect(d.consent).toBe('expired');
  });

  it('allows a record whose retention window is still open', () => {
    expect(
      decide(req({ record: record({ retentionUntil: new Date('2027-01-01T00:00:00.000Z') }) }))
        .allowed,
    ).toBe(true);
  });
});

describe('absolute prohibitions', () => {
  it('refuses training use, whatever else is true', () => {
    expectDenial(req({ record: record({ trainingUse: true }) }), 'training_use_forbidden');
  });
});

describe('service vault authorisation', () => {
  it('refuses a service that cannot reach the purpose’s vault', () => {
    expectDenial(
      req({ purpose: EXPLICIT, consent: GRANTED, serviceVaults: ['community'] }),
      'service_vault_not_permitted',
    );
  });

  it('allows one that can', () => {
    expect(
      decide(req({ purpose: EXPLICIT, consent: GRANTED, serviceVaults: ['clinical'] })).allowed,
    ).toBe(true);
  });
});

describe('emergency-restricted records', () => {
  const emergency = record({ kind: 'emergency_contact', visibility: 'emergency_restricted' });

  it('refuses without a break-glass case', () => {
    expectDenial(
      req({ actor: { kind: 'service', serviceId: 'break-glass' }, purpose: OVERRIDE, record: emergency }),
      'emergency_restricted_without_case',
    );
  });

  it('refuses an expired case', () => {
    expectDenial(
      req({
        actor: { kind: 'service', serviceId: 'break-glass' },
        purpose: OVERRIDE,
        record: emergency,
        breakGlass: {
          caseId: 'C-1',
          state: 'access_granted',
          fieldsPermitted: ['emergency_contact'],
          expiresAt: new Date('2026-09-10T11:00:00.000Z'),
        },
      }),
      'break_glass_expired',
    );
  });

  it('refuses a field the case did not name', () => {
    expectDenial(
      req({
        actor: { kind: 'service', serviceId: 'break-glass' },
        purpose: OVERRIDE,
        record: record({ kind: 'journal_entry', visibility: 'emergency_restricted' }),
        breakGlass: {
          caseId: 'C-1',
          state: 'access_granted',
          fieldsPermitted: ['emergency_contact'],
          expiresAt: new Date('2026-09-10T13:00:00.000Z'),
        },
      }),
      'break_glass_field_not_permitted',
    );
  });

  it('allows a live case for a named field, recorded as an override', () => {
    const d = decide(
      req({
        actor: { kind: 'service', serviceId: 'break-glass' },
        purpose: OVERRIDE,
        record: emergency,
        breakGlass: {
          caseId: 'C-1',
          state: 'access_granted',
          fieldsPermitted: ['emergency_contact'],
          expiresAt: new Date('2026-09-10T13:00:00.000Z'),
        },
      }),
    );
    expect(d.allowed).toBe(true);
    // Never 'granted'. The user did not consent; a vital interest overrode them, and
    // the audit trail has to say which.
    expect(d.consent).toBe('override');
  });
});

describe('step-up assertions', () => {
  it('refuses when none was presented', () => {
    expectDenial(req({ requiredStepUpScope: '/api/data-rights' }), 'step_up_required');
  });

  it('refuses one scoped to something else', () => {
    expectDenial(
      req({
        requiredStepUpScope: '/api/data-rights',
        actor: { kind: 'self', pseudoId: OWNER, steppedUpScope: '/api/billing' },
      }),
      'step_up_scope_mismatch',
    );
  });

  it('allows a correctly scoped one', () => {
    expect(
      decide(
        req({
          requiredStepUpScope: '/api/data-rights',
          actor: { kind: 'self', pseudoId: OWNER, steppedUpScope: '/api/data-rights' },
        }),
      ).allowed,
    ).toBe(true);
  });
});

describe('therapist access', () => {
  const shared = record({ visibility: 'shared_with_therapist', therapistAccess: true });
  const therapist = { kind: 'therapist' as const, actorId: 'T-982' };
  const active = { therapistId: 'T-982', active: true, scope: 'individual' as const };

  it('is allowed with an active relationship and a shared record', () => {
    const d = decide(
      req({ actor: therapist, purpose: EXPLICIT, consent: GRANTED, care: active, record: shared }),
    );
    expect(d.allowed).toBe(true);
    expect(d.consent).toBe('granted');
  });

  it('is refused with no relationship at all', () => {
    expectDenial(
      req({ actor: therapist, purpose: EXPLICIT, consent: GRANTED, record: shared }),
      'therapist_not_assigned',
    );
  });

  it('is refused for a different therapist', () => {
    expectDenial(
      req({
        actor: { kind: 'therapist', actorId: 'T-111' },
        purpose: EXPLICIT,
        consent: GRANTED,
        care: active,
        record: shared,
      }),
      'therapist_not_assigned',
    );
  });

  it('is refused once the care relationship has ended', () => {
    // Checked BEFORE consent, so a stale grant cannot outlive the relationship.
    expectDenial(
      req({
        actor: therapist,
        purpose: EXPLICIT,
        consent: GRANTED,
        care: { ...active, active: false },
        record: shared,
      }),
      'care_relationship_ended',
    );
  });

  it('is refused when an individual therapist holds only a group relationship', () => {
    expectDenial(
      req({
        actor: therapist,
        purpose: EXPLICIT,
        consent: GRANTED,
        care: { ...active, scope: 'group' },
        record: shared,
      }),
      'therapist_scope_mismatch',
    );
  });

  it('is refused for a record the user kept private', () => {
    expectDenial(
      req({
        actor: therapist,
        purpose: EXPLICIT,
        consent: GRANTED,
        care: active,
        record: record({ visibility: 'private_to_user' }),
      }),
      'visibility_private_to_user',
    );
  });

  it('is refused when the record is not shared, even if visibility suggests it', () => {
    expectDenial(
      req({
        actor: therapist,
        purpose: EXPLICIT,
        consent: GRANTED,
        care: active,
        record: record({ visibility: 'shared_with_therapist', therapistAccess: false }),
      }),
      'record_not_shared_with_therapist',
    );
  });

  it('is refused when a group record is offered to an individual therapist', () => {
    expectDenial(
      req({
        actor: therapist,
        purpose: EXPLICIT,
        consent: GRANTED,
        care: active,
        record: record({ visibility: 'shared_with_group_therapist', therapistAccess: true }),
      }),
      'record_not_shared_with_therapist',
    );
  });
});

describe('the AI tier', () => {
  const aiActor = { kind: 'ai' as const, serviceId: 'therapist-insight' };
  const analysable = record({ aiAnalysis: 'allowed', aiPurpose: 'therapist-session-prep' });

  it('is allowed when purpose, record and AI purpose all agree', () => {
    expect(
      decide(
        req({ actor: aiActor, action: 'analyse', purpose: EXPLICIT, consent: GRANTED, record: analysable }),
      ).allowed,
    ).toBe(true);
  });

  it('is refused when the purpose forbids AI', () => {
    expectDenial(
      req({ actor: aiActor, action: 'analyse', purpose: IMPLIED, record: analysable }),
      'purpose_forbids_ai',
    );
  });

  it('is refused when the record forbids AI', () => {
    expectDenial(
      req({
        actor: aiActor,
        action: 'analyse',
        purpose: EXPLICIT,
        consent: GRANTED,
        record: record({ aiAnalysis: 'not_allowed' }),
      }),
      'record_forbids_ai',
    );
  });

  it('is refused when the record was consented for a DIFFERENT AI purpose', () => {
    // Consent to a weekly summary is not consent to anything else.
    expectDenial(
      req({
        actor: aiActor,
        action: 'analyse',
        purpose: EXPLICIT,
        consent: GRANTED,
        record: record({ aiAnalysis: 'allowed', aiPurpose: 'group-session-summary' }),
      }),
      'ai_purpose_mismatch',
    );
  });

  it('cannot write, delete or share', () => {
    for (const action of ['write', 'delete', 'share'] as const) {
      expectDenial(
        req({ actor: aiActor, action, purpose: EXPLICIT, consent: GRANTED, record: analysable }),
        'actor_kind_not_permitted',
      );
    }
  });
});

describe('actors with no clinical reach at all', () => {
  it('refuses moderators, partners, safety reviewers and admins', () => {
    for (const kind of ['moderator', 'partner', 'safety_reviewer', 'admin'] as const) {
      expectDenial(
        req({
          actor: { kind, actorId: 'X-1' },
          purpose: EXPLICIT,
          consent: GRANTED,
          record: record({ visibility: 'shared_with_therapist', therapistAccess: true }),
        }),
        'actor_kind_not_permitted',
      );
    }
  });
});

describe('consent state', () => {
  const base = {
    actor: { kind: 'self' as const, pseudoId: OWNER },
    purpose: EXPLICIT,
  };

  it('refuses when no consent record exists', () => {
    expectDenial(req(base), 'consent_absent');
  });

  it('refuses when the consent is for another purpose', () => {
    expectDenial(
      req({ ...base, consent: { ...GRANTED, purpose: 'data-export' } }),
      'consent_absent',
    );
  });

  it('refuses a withdrawn consent, and records it as withdrawn', () => {
    const d = expectDenial(
      req({ ...base, consent: { ...GRANTED, state: 'withdrawn', withdrawnAt: NOW } }),
      'consent_withdrawn',
    );
    expect(d.consent).toBe('withdrawn');
  });

  it('refuses an expired consent', () => {
    const d = expectDenial(
      req({ ...base, consent: { ...GRANTED, state: 'expired' } }),
      'consent_expired',
    );
    expect(d.consent).toBe('expired');
  });

  it('refuses a superseded consent', () => {
    expectDenial(
      req({ ...base, consent: { ...GRANTED, state: 'superseded' } }),
      'consent_superseded',
    );
  });

  it('refuses a granted consent whose window has already closed', () => {
    // The stored state is maintained by a job; the timestamp is the truth.
    expectDenial(
      req({
        ...base,
        consent: { ...GRANTED, expiresAt: new Date('2026-09-01T00:00:00.000Z') },
      }),
      'consent_expired',
    );
  });

  it('needs no grant for a not-required purpose', () => {
    expect(decide(req({ purpose: NOT_REQUIRED })).consent).toBe('not_required');
  });

  it('needs no grant for an implied-by-service purpose', () => {
    expect(decide(req({ purpose: IMPLIED })).consent).toBe('granted');
  });
});

describe('the denial vocabulary is fully reachable', () => {
  it('exercises every declared Denial', () => {
    // Kept in step with the Denial union by hand, because TypeScript erases it.
    const declared: Denial[] = [
      'maximum_privacy_no_platform_key',
      'record_pending_purge',
      'retention_expired',
      'training_use_forbidden',
      'not_owner',
      'visibility_private_to_user',
      'record_not_shared_with_therapist',
      'therapist_not_assigned',
      'care_relationship_ended',
      'therapist_scope_mismatch',
      'consent_absent',
      'consent_withdrawn',
      'consent_expired',
      'consent_superseded',
      'purpose_forbids_ai',
      'record_forbids_ai',
      'ai_purpose_mismatch',
      'emergency_restricted_without_case',
      'break_glass_expired',
      'break_glass_field_not_permitted',
      'step_up_required',
      'step_up_scope_mismatch',
      'service_vault_not_permitted',
      'actor_kind_not_permitted',
    ];

    const unreached = declared.filter((d) => !seen.has(d));
    expect(unreached, 'every denial reason must be reachable by some test').toEqual([]);
  });
});
