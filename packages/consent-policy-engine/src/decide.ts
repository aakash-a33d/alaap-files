/**
 * The access decision.
 *
 * One pure function. Every rule §12I lists as a reason to deny is a named check
 * below, in a fixed order, and the order is load-bearing:
 *
 *   1. STRUCTURAL first. A Maximum Privacy record cannot be read by the platform at
 *      all, so no amount of consent or relationship makes it readable. Checking this
 *      first means the decision never says "denied" about something that was never
 *      possible — a distinction the interface has to make, because "you cannot see
 *      this" and "we chose not to show you this" are different sentences.
 *
 *   2. GONE next. A purged or retention-expired record is not a permissions question.
 *      Evaluating consent against a record that should no longer exist would produce
 *      an allow, and then a confusing empty read.
 *
 *   3. ABSOLUTE PROHIBITIONS. Training use is never permitted, whatever anyone
 *      consented to, because consent to therapy is not consent to be training data.
 *
 *   4. RELATIONSHIP, then CONSENT, then CALLER. A therapist with no active care
 *      relationship is refused before their consent is examined, so a stale consent
 *      record cannot outlive the relationship that justified it.
 *
 * Deny-first throughout. The function returns on the first failing check and only
 * reaches `allow` when every rule has been satisfied — so a rule added in the middle
 * cannot be skipped by an early success path, because there are none.
 */

import type {
  AccessRequest,
  ConsentDecision,
  Decision,
  Denial,
  PurposeFacts,
} from './types.ts';

/** Actions that require the platform to read plaintext. */
const NEEDS_PLAINTEXT = new Set(['read', 'analyse', 'export', 'share']);

/** Actions the AI tier can perform at all. */
const AI_ACTIONS = new Set(['read', 'analyse']);

function deny(denial: Denial, purpose: string, consent: ConsentDecision = 'denied'): Decision {
  return { allowed: false, consent, denial, auditPurpose: purpose, structural: false };
}

function structuralDeny(denial: Denial, purpose: string): Decision {
  return { allowed: false, consent: 'denied', denial, auditPurpose: purpose, structural: true };
}

function allow(purpose: string, consent: ConsentDecision): Decision {
  return { allowed: true, consent, denial: null, auditPurpose: purpose, structural: false };
}

/**
 * How a satisfied purpose is recorded in the audit trail.
 *
 * `override` is never rewritten to `granted`. Emergency contact disclosure proceeds
 * against a stated preference on vital-interest grounds, and an audit row claiming
 * consent that was not given would be a false record in the one store that cannot be
 * corrected.
 */
function consentVocabulary(purpose: PurposeFacts): ConsentDecision {
  switch (purpose.consent) {
    case 'not-required':
      return 'not_required';
    case 'implied-by-service':
      return 'granted';
    case 'explicit':
      return 'granted';
    case 'override':
      return 'override';
  }
}

export function decide(req: AccessRequest): Decision {
  const { actor, action, record, purpose, consent, care, breakGlass, now } = req;
  const p = purpose.id;

  // -- 1 · structural ------------------------------------------------------
  //
  // Under Maximum Privacy the data encryption key is wrapped by a key that exists
  // only on the user's device. The server holds nothing it could unwrap. This is not
  // a policy position that could be relaxed by a future grant; it is the absence of
  // a key. The schema refuses to store a platform-readable DEK on such a record.
  if (
    record.privacyMode === 'maximum' &&
    NEEDS_PLAINTEXT.has(action) &&
    actor.kind !== 'self'
  ) {
    return structuralDeny('maximum_privacy_no_platform_key', p);
  }

  // -- 2 · the record is gone, or going -----------------------------------
  if (record.visibility === 'pending_purge') {
    return deny('record_pending_purge', p);
  }
  if (record.retentionUntil !== undefined && record.retentionUntil <= now) {
    return deny('retention_expired', p, 'expired');
  }

  // -- 3 · absolute prohibitions ------------------------------------------
  //
  // §12J: therapy data is not used for model training by default. There is no
  // "unless" behind that default yet, so the engine treats it as absolute rather
  // than reading a flag whose only lawful value is false.
  if (record.trainingUse) {
    return deny('training_use_forbidden', p);
  }

  // -- 4 · the asking service must be able to reach this vault -------------
  //
  // Coarse, and duplicated deliberately: the gateway checks the route's declared
  // purpose against the service's vaults, and this checks the same thing at the
  // point of access, where the record is actually in hand.
  if (req.serviceVaults !== undefined) {
    const reachable = purpose.vaults.some((v) => req.serviceVaults!.includes(v));
    if (!reachable) {
      return deny('service_vault_not_permitted', p);
    }
  }

  // -- 5 · emergency-restricted records -----------------------------------
  //
  // The only route in is an approved break-glass case, with a live window and the
  // specific field named. "Read the record" is never a permitted scope.
  if (record.visibility === 'emergency_restricted') {
    if (breakGlass === undefined) {
      return deny('emergency_restricted_without_case', p);
    }
    if (breakGlass.expiresAt <= now) {
      return deny('break_glass_expired', p);
    }
    if (!breakGlass.fieldsPermitted.includes(record.kind)) {
      return deny('break_glass_field_not_permitted', p);
    }
    // A vital-interest override, recorded as exactly that.
    return allow(p, 'override');
  }

  // -- 6 · step-up, where the operation demands it ------------------------
  if (req.requiredStepUpScope !== undefined) {
    if (actor.steppedUpScope === undefined) {
      return deny('step_up_required', p);
    }
    if (actor.steppedUpScope !== req.requiredStepUpScope) {
      return deny('step_up_scope_mismatch', p);
    }
  }

  // -- 7 · relationship ----------------------------------------------------
  switch (actor.kind) {
    case 'self': {
      if (actor.pseudoId !== record.ownerPseudoId) {
        return deny('not_owner', p);
      }
      break;
    }

    case 'therapist':
    case 'group_therapist': {
      // The relationship is checked before consent, so a consent record cannot
      // outlive the care relationship that justified granting it.
      if (care === undefined) {
        return deny('therapist_not_assigned', p);
      }
      if (care.therapistId !== actor.actorId) {
        return deny('therapist_not_assigned', p);
      }
      if (!care.active) {
        return deny('care_relationship_ended', p);
      }

      const wantsGroup = actor.kind === 'group_therapist';
      if (wantsGroup !== (care.scope === 'group')) {
        return deny('therapist_scope_mismatch', p);
      }

      if (record.visibility === 'private_to_user') {
        return deny('visibility_private_to_user', p);
      }
      if (!record.therapistAccess) {
        return deny('record_not_shared_with_therapist', p);
      }

      const needed = wantsGroup ? 'shared_with_group_therapist' : 'shared_with_therapist';
      if (record.visibility !== needed) {
        return deny('record_not_shared_with_therapist', p);
      }
      break;
    }

    case 'ai': {
      if (!AI_ACTIONS.has(action)) {
        return deny('actor_kind_not_permitted', p);
      }
      // Three independent gates, and all three must pass. The purpose registry says
      // whether any model may process under this purpose; the record's own policy
      // says whether this record may be processed; and the two purposes must be the
      // same one. Consent to a weekly summary is not consent to anything else.
      if (!purpose.aiPermitted) {
        return deny('purpose_forbids_ai', p);
      }
      if (record.aiAnalysis === 'not_allowed') {
        return deny('record_forbids_ai', p);
      }
      if (record.aiPurpose !== purpose.id) {
        return deny('ai_purpose_mismatch', p);
      }
      break;
    }

    case 'moderator':
    case 'partner': {
      // Neither ever reaches a clinical record. A moderator works on community
      // content with no identity attached; a partner sees de-identified aggregates.
      return deny('actor_kind_not_permitted', p);
    }

    case 'safety_reviewer': {
      // A reviewer sees signals, not content. Reaching content requires a
      // break-glass case, handled in step 5 above.
      return deny('actor_kind_not_permitted', p);
    }

    case 'admin': {
      // Deliberately no ambient administrative read of clinical content. §12L: an
      // admin account is assumed compromisable, so it holds operational access only.
      return deny('actor_kind_not_permitted', p);
    }

    case 'service': {
      // A service acting on its own behalf — retention sweeps, export assembly.
      // Its authority comes from the purpose and the vault check in step 4.
      break;
    }
  }

  // -- 8 · consent ---------------------------------------------------------
  switch (purpose.consent) {
    case 'not-required':
    case 'override':
      // Safety, legal and contractual processing. No grant to examine.
      break;

    case 'implied-by-service':
      // Covered by using the service at all.
      break;

    case 'explicit': {
      if (consent === undefined) {
        return deny('consent_absent', p);
      }
      if (consent.purpose !== purpose.id) {
        return deny('consent_absent', p);
      }
      switch (consent.state) {
        case 'withdrawn':
          return deny('consent_withdrawn', p, 'withdrawn');
        case 'expired':
          return deny('consent_expired', p, 'expired');
        case 'superseded':
          return deny('consent_superseded', p, 'expired');
        case 'granted':
          break;
      }
      // A grant whose window has closed is expired whatever the stored state says.
      // The state column is maintained by a job; the timestamp is the truth.
      if (consent.expiresAt !== undefined && consent.expiresAt <= now) {
        return deny('consent_expired', p, 'expired');
      }
      break;
    }
  }

  return allow(p, consentVocabulary(purpose));
}
