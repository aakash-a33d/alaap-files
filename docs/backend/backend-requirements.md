# Backend requirements — MVP

Status: **finalized for MVP**. Resolves two contradictions in the architecture documents
(§12E.2 vs §11.6, and the voice-masking tap point) and fixes the decisions the
architecture left open.

Declarative companions, all CI-validated:

| File | Owns |
| --- | --- |
| [`metadata/access-control/vault-access-matrix/vault-access.v1.yaml`](../../metadata/access-control/vault-access-matrix/vault-access.v1.yaml) | Which service may touch which vault, and the deployable it runs in |
| [`metadata/consent/purpose-registry/purposes.v1.yaml`](../../metadata/consent/purpose-registry/purposes.v1.yaml) | Every purpose string a handler may declare |
| [`metadata/api/service-registry.v1.yaml`](../../metadata/api/service-registry.v1.yaml) | Services, API groups, owned entities |

---

## 1. Deployment topology

Seventeen services, **three deployables**.

| Deployable | Contains | Runtime |
| --- | --- | --- |
| `core` | Gateway + 15 domain services + workers | Node.js |
| `identity-isolate` | `identity-vault-service`, `break-glass-service` | Node.js |
| `ai-tier` | Orchestrator and the AI zones | Python |

The service *code* is written as if all seventeen were separately deployable — hexagonal
layout, no cross-service table reads, no shared imports outside `packages/`. The
boundaries are enforced by `tools/privacy-lint` and CI, not by process separation, so
extracting a service later is a deployment change and not a rewrite.

`identity-isolate` is separate for **containment, not scale**. It holds the records whose
disclosure is unrecoverable — legal names, verified numbers, emergency contacts — and a
memory-disclosure bug in community code must not be able to reach them. It runs on its own
network segment, with its own database credentials, and the only paths into it are the
identity and break-glass service APIs.

### Rules

- `core` reaches `identity-isolate` over the network, authenticated service-to-service.
  There is no in-process call path and no shared database connection.
- `identity-isolate` initiates no outbound calls except audit writes.
- Neither deployable holds the other's database credentials or encryption keys.

---

## 2. Vault topology

Five vaults, **three database instances**.

| Vault | Instance | Rationale |
| --- | --- | --- |
| Identity | Dedicated | A leak attaches real names to mental-health usage. Unrecoverable. |
| Audit | Dedicated | Must survive an attacker who owns the application database, or they erase their own tracks. |
| Community | Shared instance, own database + role + keys | Recoverable; highest traffic |
| Clinical | Shared instance, own database + role + keys | |
| Billing | Shared instance, own database + role + keys | |
| *(core)* | Shared instance, own database + role + keys | Not a protected domain — see below |

`core` is a sixth database holding authentication state: accounts, passkey credentials,
recovery codes, trusted devices, session records and login events. It is deliberately
outside the vault access matrix, because it holds credentials rather than one of the five
protected data domains, and including it would dilute what that matrix exists to prevent.
Only `auth-service` holds credentials to it, enforced in `database/policies/roles-grants/`.

Three instances still: Identity dedicated, Audit dedicated, and `core` + Community +
Clinical + Billing sharing the third with separate databases, roles and keys.

§12B permits "separate database or schema". The two vaults whose compromise cannot be
undone get physical separation; the other three get logical separation with distinct
roles, distinct encryption keys and distinct backup policies.

The full permission grid is `metadata/access-control/vault-access-matrix/`. A service with
no entry there gets no vault access — absence is denial, not default-allow.

### Rules

- No cross-database joins. Cross-vault reads go through the owning service's API.
- **A vault may have more than one service holding credentials, but only over disjoint
  table sets.** Every table has exactly one owning service, declared in the service
  registry and checked in CI. The community vault, for example, is co-tenanted by
  `pseudonym-service`, `community-service` and `moderation-service`, none of which can
  read another's tables. A service reaching a table it does not own goes over the network.
- The Identity Vault stores no community posts, journals or moderation history.
- The Audit Vault's application role holds `INSERT` only. No `UPDATE`, no `DELETE`, in any
  environment.

---

## 3. Clinical encryption — dual mode

**Resolves the contradiction between §12E.2 (journals must be client-side encrypted) and
§11.6 (the AI temporarily decrypts approved clinical data).** As written those cannot both
hold: under client-side encryption only the user's device has the key, so the server
cannot decrypt anything for the AI to read.

| Mode | Key holder | AI analysis | Therapist sharing | Recovery |
| --- | --- | --- | --- | --- |
| **Standard** (default) | Platform, envelope-encrypted per record | Yes, with consent | Yes, with consent | Yes |
| **Maximum Privacy** | User's device | **Structurally impossible** | Only if re-shared by the user | **No — lost device, lost records** |

The user chooses, per §12S. Maximum Privacy Mode visibly disables therapist insight and AI
summaries for the affected records rather than silently failing, matching the copy already
written in §12S: *"Some features … will work only after you choose to share specific
information."*

Standard mode is not a weakening. Records are envelope-encrypted with a unique data
encryption key per record, wrapped by a domain key that never leaves the KMS. Consent is
checked before every decrypt, and every decrypt writes an audit event.

Full client-side encryption as the default belongs to the native app, which §12T already
identifies as the strongest privacy environment. **In a browser, the server ships the
JavaScript on every load** — so a compromised server can exfiltrate browser-held keys, and
client-side encryption offers less real protection there than its cost suggests.

### Rules

- Maximum Privacy records are never sent to the AI tier, in any zone, for any purpose.
- Recovery limits are stated at the moment the user enables the mode, not buried in policy.
- Switching from Maximum Privacy to Standard re-encrypts forward only. Prior records stay
  user-held until explicitly re-shared.

---

## 4. Realtime and the voice-masking tap

**LiveKit, self-hosted** (Apache-2.0), deployed in-region.

Therapy session audio never transits a third party. This is not only a privacy preference —
it follows from the pre-mask ASR tap decision recorded in the
[AI requirements](../ai/ai-requirements.md), which needs server-side access to each
participant's unmasked track. Most managed WebRTC vendors do not expose that.

### Voice masking must run server-side

A consequence of the pre-mask tap that the architecture documents do not state: **if
masking runs in the browser, the server never receives unmasked audio and the tap is
impossible.** Masking therefore runs in the SFU — clean audio in, masked audio published
to peers, the original available to the transcription pipeline.

This raises SFU complexity materially, and it is the reason a managed vendor was rejected.

### Rules

- Unmasked audio is streamed to transcription and never written to disk.
- Transcription runs only for a Recorded Review Session, and only inside the Confidential
  AI Processing Zone.
- Every tap writes an audit event.
- Session media keys are per-session and are never reused.

---

## 5. Sessions and authentication

**Opaque session tokens in Redis.** Not stateless JWTs.

Zero-trust operations require instant revocation — remote logout from all devices,
immediate access removal on staff exit, session kill on suspicious login. A stateless JWT
cannot be revoked without a server-side blocklist, at which point it is a slower opaque
session with extra failure modes.

The session record carries the step-up assertions, so a sensitive action can require a
fresh verification without a second round trip to the auth service.

### Rules

- Sessions are sliding-window with an absolute maximum lifetime.
- Step-up assertions expire independently of, and sooner than, the session.
- Therapist and staff sessions carry a shorter absolute lifetime than user sessions.
- Redis loss logs everyone out. This is correct behaviour and must not be "fixed" with a
  fallback that weakens revocation.

---

## 6. Key management

**OpenBao Transit** (Apache-2.0 fork of Vault) at MVP.

Deliberately cloud-agnostic, because production hosting is deferred. Keys wrap and unwrap
through the Transit engine without leaving it, and the migration path to a managed KMS/HSM
is a key-rewrap job rather than an architectural change.

> HashiCorp Vault itself is now BUSL-1.1. That licence permits internal production use,
> but OpenBao removes the question entirely — consistent with the permissive-licence-only
> policy applied to the AI tier.

Key hierarchy is unchanged from §12F: master keys in the KMS, domain keys per vault, data
encryption keys per record for sensitive records, session keys for live media.

### Rules

- Each vault uses a different domain key. Compromise of one does not read another.
- The AI tier never receives identity-vault keys. Moderation never receives clinical keys.
  Billing never receives therapy-content keys.
- Backups use separate backup keys, held by a separate role.
- No production key material exists in development or staging, ever.

---

## 7. Queues and jobs

**BullMQ on the existing Redis** for ordinary asynchronous work — AI response generation,
notifications, index sync.

**A Postgres outbox for work that must not be lost:** data deletion requests, retention
jobs, therapist payouts, audit sealing. These are written in the same transaction as the
state change that caused them and drained by a worker.

Losing a queued AI response is a nuisance. Losing a deletion request is a compliance
incident, and Redis is not a durable store.

---

## 8. Audit immutability

An append-only table with a hash chain — each row carries the hash of its predecessor, so
a deletion or edit breaks the chain and is detectable. Periodically sealed to object
storage under Object Lock.

Audit event fields are fixed by §12P: `request_id, pseudo_id, actor_id, actor_role,
service_name, action_type, purpose, consent_decision, access_result, timestamp,
risk_score`. Event types are registered in `metadata/audit/event-types/`.

### Rules

- The application role holds `INSERT` only.
- Sealing runs from the outbox, not a cron, so a missed window is recoverable.
- Audit writes never block the request path, but a failed audit write fails the operation
  it was recording. An unlogged sensitive access is not an acceptable outcome.

---

## 9. Consent engine placement

`packages/consent-policy-engine` is a library evaluated in **two** places:

| Where | Checks |
| --- | --- |
| Gateway | Coarse: authentication, role, declared purpose, rate limit, purpose limitation |
| Owning service | Record-level: is this therapist assigned, did the user share *this* record, has consent expired, does the retention window still hold |

The gateway cannot make the second class of decision — it does not know whether therapist
`T-982` is assigned to journal `J-3912`. Enforcing only at the gateway would be a
correctness bug disguised as a security boundary.

Every handler that reads protected data declares a purpose string from
`metadata/consent/purpose-registry/`. CI rejects handlers that declare a purpose not in the
registry.

---

## 10. External vendors

| Need | Choice | Note |
| --- | --- | --- |
| Payments | **Razorpay** | Subscriptions, Route for partner-subsidy split settlement, and therapist payouts in one vendor |
| SMS / OTP | **MSG91 or Gupshup** | ⚠️ See lead time below |
| Realtime | **LiveKit**, self-hosted | §4 |
| Secrets / KMS | **OpenBao** | §6 |

Recurring debits for the ₹99 and ₹799 plans fall under RBI e-mandate rules, which require
a pre-debit notification and an explicit mandate. Card-on-file tokenization applies. No
card data touches our infrastructure — the Billing Vault stores gateway token references
only, per §12B.

### Lead-time warning

**TRAI DLT registration gates every OTP the platform sends and takes weeks.** It is the
longest external dependency in the backend and it blocks registration, which blocks
everything. Start it independently of all other work.

---

## 11. Identity tiers

Identity is collected only at the point a specific obligation requires it. Nothing is
gathered "in case it is needed later".

| Tier | Collected | Trigger |
| --- | --- | --- |
| 0 · Anonymous Community | Verified phone (stored as a blind index), age band | Registration |
| 1 · Interaction Plus | + payment token reference; the gateway holds the instrument | Paid plan |
| 2 · Group / one-to-one **psychologist** | + first name for addressing, + emergency contact (opt-in) | Care booking |
| 3 · **Psychiatrist** | + identity verification per Telemedicine Practice Guidelines 2020 | Medical consultation |
| 4 · Subsidy | + eligibility documents, government ID where the funder requires it | Subsidy claim |

**Government ID is collected at tier 4 only.** Free and Interaction Plus users never
provide one. Tier 2 collects a first name so a therapist can address a person by name —
that is a courtesy field, not an identity assertion, and it is not verified.

Tier 3 exists because identity obligations vary by **practitioner type**, not by plan. A
psychiatrist is a Registered Medical Practitioner and the Telemedicine Practice Guidelines
require them to verify patient identity; a counsellor or clinical psychologist is not an
RMP and the same requirement does not attach. Prescription rules add further
patient-particulars obligations at this tier.

This is pseudonymity, not anonymity, and product copy must say so. A phone number is
personal data under both DPDP and GDPR, and Indian numbers are KYC-linked at the telco, so
users remain re-identifiable by lawful process. The architecture already states this
honestly — *"anonymous to other users, but not untraceable to the platform"* — and
marketing must not drift past it.

### Open compliance items

- **Age assurance is the sharpest tension in this model.** DPDP §9 requires verifiable
  parental consent for under-18s, and a self-declared age checkbox is unlikely to qualify.
  A mental wellness platform is precisely where minors arrive, so this is a predictable
  segment rather than an edge case. Minimal identity and verifiable age assurance pull in
  opposite directions. **Counsel must resolve this before launch.**
- **Special-category data is unaffected by minimisation.** GDPR Art. 9 and the DPDP
  treatment of health data attach to the *content*, not to how much identity accompanies
  it. Collecting less identity does not lower the bar for consent or safeguards on
  journals, posts and session records.
- **Crisis reachability.** A tier 0 user who declines an emergency contact can be reached
  only through their own phone. The safety runbook must state what a high-risk case does
  when there is no second contact, rather than assuming one exists.

## Decision record

To be recorded as numbered ADRs before implementation:

| Decision | Resolution |
| --- | --- |
| Deployment topology | Three deployables; boundaries enforced in CI, not by process |
| Vault topology | Identity and Audit physically separate; three share an instance |
| Clinical encryption | Dual mode — Standard default, Maximum Privacy opt-in |
| Realtime | LiveKit self-hosted; masking moves server-side |
| Sessions | Opaque Redis sessions, not JWT |
| Key management | OpenBao Transit, cloud-agnostic |
| Durable jobs | Postgres outbox for compliance-critical work |

## Open

- **Object storage provider** — deferred with production hosting, but Object Lock support
  is a hard requirement for audit sealing, so it constrains the choice.
- **Search index.** §12 requires one but nothing in the MVP scope needs full-text search
  across vaults. Confirm it can be dropped from the first release.
- **Group matching algorithm.** §8.2 lists eleven preference variables but no weighting.
  This is a clinical decision, not an engineering one, and needs therapist input.
