/**
 * packages/consent-policy-engine
 *
 * The only implementation of "may this actor read this record for this purpose".
 * A service answering that question locally is a bug (backend-requirements §9).
 *
 * Evaluated in two places, with different completeness:
 *
 *   gateway   coarse — authentication, role, declared purpose, purpose limitation
 *   service   record-level — is this therapist assigned, did the user share THIS
 *             record, has consent expired, does the retention window still hold
 *
 * The gateway cannot make the second class of decision: it does not know whether
 * therapist T-982 is assigned to journal J-3912, and enforcing only there would be a
 * correctness bug disguised as a security boundary.
 */

export { decide } from './decide.ts';
export type {
  AccessRequest,
  Action,
  Actor,
  ActorKind,
  AiAnalysis,
  BreakGlassFacts,
  CareRelationshipFacts,
  ConsentDecision,
  ConsentFacts,
  Decision,
  Denial,
  Layer,
  PrivacyMode,
  PurposeFacts,
  RecordFacts,
  RecordKind,
  Visibility,
} from './types.ts';
