/**
 * The facts a caller must gather before an access decision can be made.
 *
 * THIS FILE IS THE CONTRACT, and its shape is deliberate. The engine takes facts,
 * never repositories — no database handle, no HTTP client, no clock it reads itself.
 * Three consequences follow, and all three are the point:
 *
 *   1. It is exhaustively unit-testable with no fixtures, so every denial path can be
 *      asserted rather than hoped about.
 *   2. A caller cannot accidentally widen a decision by passing a permissive default,
 *      because every field the decision depends on is required.
 *   3. The input type states, in one place, exactly what a service has to know before
 *      it opens a record. A service that cannot fill this in has no business
 *      decrypting anything.
 *
 * backend-requirements §9 makes this the ONLY implementation of "may this actor read
 * this record for this purpose". A service answering that question locally is a bug.
 */

// The cross-cutting vocabulary lives in @alaap/shared-types, where each union
// carries the database CHECK constraint it mirrors. Re-exported so a caller needs one
// import rather than two.
import type {
  AiAnalysis,
  ConsentDecision,
  PrivacyMode,
  RecordKind,
  Visibility,
} from '@alaap/shared-types';

export type { AiAnalysis, ConsentDecision, PrivacyMode, RecordKind, Visibility };

/** Where a decision is being made. Affects nothing but the audit trail. */
export type Layer = 'gateway' | 'service';

export type Action = 'read' | 'write' | 'delete' | 'analyse' | 'export' | 'share';

export type ActorKind =
  | 'self'
  | 'therapist'
  | 'group_therapist'
  | 'moderator'
  | 'safety_reviewer'
  | 'admin'
  | 'partner'
  | 'ai'
  | 'service';

export interface Actor {
  kind: ActorKind;
  /** Present for `self`. The join key across vaults, never a legal identity. */
  pseudoId?: number;
  /** Staff, therapist or service identifier. Never a name. */
  actorId?: string;
  /** Which service is asking. Checked against the purpose's permitted vaults. */
  serviceId?: string;
  /** Step-up assertion, if one was presented. Expiry is the caller's to enforce. */
  steppedUpScope?: string;
  steppedUpAt?: Date;
}

export interface RecordFacts {
  kind: RecordKind;
  ownerPseudoId: number;
  visibility: Visibility;
  aiAnalysis: AiAnalysis;
  /** Required whenever aiAnalysis is not `not_allowed` — the schema enforces it too. */
  aiPurpose?: string;
  therapistAccess: boolean;
  privacyMode: PrivacyMode;
  trainingUse: boolean;
  /** Null means no retention limit has been set on this record. */
  retentionUntil?: Date;
}

/** One purpose from metadata/consent/purpose-registry/, as loaded. */
export interface PurposeFacts {
  id: string;
  consent: 'explicit' | 'implied-by-service' | 'not-required' | 'override';
  basis:
    | 'consent'
    | 'contract'
    | 'legal-obligation'
    | 'vital-interest'
    | 'legitimate-safety'
    | 'data-subject-right';
  aiPermitted: boolean;
  vaults: readonly string[];
}

/** The consent record for this owner and purpose, if one exists. */
export interface ConsentFacts {
  purpose: string;
  state: 'granted' | 'withdrawn' | 'expired' | 'superseded';
  grantedAt: Date;
  expiresAt?: Date;
  withdrawnAt?: Date;
}

/** The care relationship between a therapist and the record's owner, if any. */
export interface CareRelationshipFacts {
  therapistId: string;
  active: boolean;
  scope: 'individual' | 'group';
}

/** An approved break-glass case, the only route to emergency-restricted data. */
export interface BreakGlassFacts {
  caseId: string;
  state: 'access_granted';
  fieldsPermitted: readonly string[];
  expiresAt: Date;
}

export interface AccessRequest {
  layer: Layer;
  actor: Actor;
  action: Action;
  record: RecordFacts;
  purpose: PurposeFacts;
  /** Absent means no consent record exists for this owner and purpose. */
  consent?: ConsentFacts;
  care?: CareRelationshipFacts;
  breakGlass?: BreakGlassFacts;
  /** Which vaults the asking service may reach, from the vault access matrix. */
  serviceVaults?: readonly string[];
  /** Group prefix a step-up assertion must be scoped to, when one is required. */
  requiredStepUpScope?: string;
  /** Injected rather than read, so time is a fact like any other. */
  now: Date;
}

/**
 * Why an access was refused.
 *
 * Machine-readable and stable — these end up in `audit_events.context.denial_reason`
 * and in metrics. Never rendered to a caller verbatim: a precise denial reason is a
 * probing oracle, which is why the gateway returns 404 where a naive design would
 * return 403.
 */
export type Denial =
  // structural — the platform physically cannot do this
  | 'maximum_privacy_no_platform_key'
  // the record is gone or going
  | 'record_pending_purge'
  | 'retention_expired'
  // never permitted
  | 'training_use_forbidden'
  // ownership and relationship
  | 'not_owner'
  | 'visibility_private_to_user'
  | 'record_not_shared_with_therapist'
  | 'therapist_not_assigned'
  | 'care_relationship_ended'
  | 'therapist_scope_mismatch'
  // consent
  | 'consent_absent'
  | 'consent_withdrawn'
  | 'consent_expired'
  | 'consent_superseded'
  // AI
  | 'purpose_forbids_ai'
  | 'record_forbids_ai'
  | 'ai_purpose_mismatch'
  // emergency
  | 'emergency_restricted_without_case'
  | 'break_glass_expired'
  | 'break_glass_field_not_permitted'
  // caller
  | 'step_up_required'
  | 'step_up_scope_mismatch'
  | 'service_vault_not_permitted'
  | 'actor_kind_not_permitted';

export interface Decision {
  allowed: boolean;
  /** What the caller must record in the audit event. */
  consent: ConsentDecision;
  denial: Denial | null;
  /** The purpose to record. Always the declared one, never a substitute. */
  auditPurpose: string;
  /**
   * True when the decision turned on something the platform cannot do rather than
   * something it declined to do. Worth separating: a Maximum Privacy record is not a
   * permission failure, and telling a user "denied" would misdescribe it.
   */
  structural: boolean;
}
