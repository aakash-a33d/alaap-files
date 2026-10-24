/**
 * packages/shared-types
 *
 * The vocabulary that crosses package boundaries. Every union here mirrors a CHECK
 * constraint in the database, and the comment on each says which — because when the
 * two disagree, the database wins and the mismatch surfaces as a constraint violation
 * at insert time rather than a type error at build time.
 *
 * WHY THIS EXISTS
 *
 * `ConsentDecision` was declared independently in both @alaap/audit-client and
 * @alaap/consent-policy-engine. Two copies of a six-member union is harmless right up
 * to the moment one of them gains a seventh member, and then the engine returns a
 * value the audit writer cannot store — a runtime failure that both packages
 * typecheck cleanly.
 *
 * TEMPORARY BY DESIGN
 *
 * folder-structure.md specifies that shared types are GENERATED into this package
 * from metadata/data/dictionary/. That dictionary does not exist yet, so these are
 * hand-written and carry the database reference in a comment instead of a generator.
 * When the dictionary lands, this file is replaced by its output — which is why
 * nothing here is anything but a type. No logic, no constants, no defaults: nothing a
 * generator would have to preserve.
 */

/**
 * Who is acting.
 *
 * Mirrors the `actor_role` CHECK on `core.sessions` and on `audit_vault.audit_events`.
 * Note that `audit_events` additionally permits `service` and `system`, which a
 * session never carries — a session always belongs to a person.
 */
export type SessionActorRole =
  | 'user'
  | 'therapist'
  | 'moderator'
  | 'admin'
  | 'safety_reviewer'
  | 'partner';

/** Mirrors the `actor_role` CHECK on `audit_events`. Superset of the session roles. */
export type AuditActorRole = SessionActorRole | 'service' | 'system';

/**
 * The consent outcome recorded against an access.
 *
 * Mirrors the `consent_decision` CHECK on `audit_events`. `override` is distinct from
 * `granted` on purpose: emergency contact disclosure proceeds against a stated
 * preference on vital-interest grounds, and recording it as consent would put a false
 * statement in the one store that can never be corrected.
 */
export type ConsentDecision =
  | 'granted'
  | 'denied'
  | 'not_required'
  | 'override'
  | 'expired'
  | 'withdrawn';

/** Mirrors the `access_result` CHECK on `audit_events`. */
export type AccessResult = 'allowed' | 'denied' | 'error';

/** The five protected data domains. `core` is deliberately not one of them. */
export type VaultName = 'identity' | 'community' | 'clinical' | 'billing' | 'audit';

/**
 * A record kind subject to a per-record access policy.
 *
 * Mirrors the `record_kind` CHECK on `clinical_vault.clinical_record_access_policies`,
 * plus the two identity-vault kinds a break-glass case can name.
 */
export type RecordKind =
  | 'journal_entry'
  | 'short_story'
  | 'mood_checkin'
  | 'attachment'
  | 'session_summary'
  | 'insight_artifact'
  | 'identity_record'
  | 'emergency_contact';

/** Mirrors the `visibility` CHECK on `clinical_record_access_policies`. */
export type Visibility =
  | 'private_to_user'
  | 'shared_with_therapist'
  | 'shared_with_group_therapist'
  | 'emergency_restricted'
  | 'pending_purge';

/** Mirrors the `ai_analysis` CHECK on `clinical_record_access_policies`. */
export type AiAnalysis = 'not_allowed' | 'allowed' | 'temporary_only';

/**
 * Dual-mode clinical encryption (backend-requirements §3).
 *
 * Under `maximum` the data encryption key is wrapped by a key held only on the user's
 * device, so AI analysis and therapist insight are structurally impossible rather
 * than merely switched off — and a lost device means lost records.
 */
export type PrivacyMode = 'standard' | 'maximum';

/** Mirrors the `consent` field in metadata/consent/purpose-registry/. */
export type PurposeConsentClass =
  | 'explicit'
  | 'implied-by-service'
  | 'not-required'
  | 'override';

/** Mirrors the `basis` field in metadata/consent/purpose-registry/. */
export type PurposeBasis =
  | 'consent'
  | 'contract'
  | 'legal-obligation'
  | 'vital-interest'
  | 'legitimate-safety'
  | 'data-subject-right';

/** Mirrors the `retention` CHECK on `audit_event_types`. */
export type AuditRetention = 'security_window' | 'long_term' | 'permanent';

/** Mirrors the `risk_band` CHECK on `safety_signals`. */
export type RiskBand = 'low' | 'moderate' | 'high' | 'imminent';
