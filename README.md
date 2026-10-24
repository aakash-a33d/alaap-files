# alaap-platform

Monorepo for **Alaap** — the privacy-preserving mental wellness platform: anonymous
pseudonymous community, Interaction Plus, Guided Group Care, one-to-one professional
care, subsidised pricing, AI moderation, therapist-support AI, and a human-reviewed
crisis workflow.

> **आलाप** · *uh-LAAP* — from Sanskrit *ālāpa*, conversation. In Hindustani music, the
> opening of a raga: unmetered, unaccompanied, one voice finding what it wants to say
> before rhythm or form arrive.
>
> *For everything left unsaid.*

The folder architecture is derived from *Privacy-Preserving Mental Wellness Platform
Architecture* and *Frontend and Backend Architecture for the Privacy-Preserving Mental
Wellness Platform*. It encodes the architecture's separation rules in the filesystem:
identity, community, clinical, billing and audit data live in different vaults, and
the directories that own them are different directories.

---

## Top-level map

| Directory | Owns | Language / stack |
| --- | --- | --- |
| `frontend/` | The React user-facing application and all seven portals | React + TypeScript + Vite |
| `backend/` | Privacy Gateway, 17 domain services, workers, realtime tier | Node.js + TypeScript + Express |
| `ai-services/` | Orchestration and inference, including the confidential processing zone | Python + FastAPI |
| `packages/` | Shared libraries used across frontend, backend and generated bindings | TypeScript |
| `metadata/` | Declarative source of truth — consent, policy, catalog, contracts, compliance | YAML / JSON |
| `database/` | Schema, migrations, RLS policy and encryption policy, split by vault | SQL |
| `infrastructure/` | Docker, Kubernetes, Terraform, KMS, networking, monitoring, CI/CD | HCL / YAML |
| `security/` | Threat models, pentest, incident response, privacy reviews | Docs |
| `tests/` | Cross-cutting contract, e2e, security, privacy, a11y and AI-safety suites | TypeScript / Python |
| `resources/` | Brand, design source, written content, media, email templates | Assets |
| `docs/` | Product, architecture, clinical, compliance, ADRs, runbooks | Markdown |
| `ops/` | Human operations: safety console, moderation playbooks, on-call | Docs |
| `tools/` `scripts/` | Codegen, privacy lint, dev and release scripts | TypeScript / shell |

---

## Full tree

```
alaap-platform/
│
├── frontend/                          React + TypeScript + Vite
│   ├── public/                        fonts, icons, static legal pages
│   └── src/
│       ├── app/                       router, providers, app-shell, guards
│       ├── pages/                     public, auth, community, dashboard,
│       │                              group-care, individual-care, therapist,
│       │                              moderator, admin, partner, legal, errors
│       ├── features/                  22 vertical slices, each with
│       │                              api/ components/ hooks/ model/ schemas/
│       │                              auth, passkeys, pseudonym, pricing, subsidy,
│       │                              community, moderation, journal, mood, therapy,
│       │                              groups, therapist-insights, crisis, consent,
│       │                              privacy, billing, notifications, data-rights,
│       │                              ai-transparency, safety-plan, guided-activities
│       ├── components/                ui, layout, forms, cards, modals, charts,
│       │                              safety, feedback, media, a11y
│       ├── services/                  api-client, websocket-client, webrtc-client,
│       │                              crypto-client, upload-client
│       ├── stores/  hooks/  schemas/  utils/  config/  types/
│       ├── styles/                    tokens/, themes/
│       ├── assets/                    images/, motion/, audio/
│       ├── i18n/locales/              en/, hi/, hi-Latn/
│       └── workers/                   service worker, on-device safety classifier
│   ├── tests/                         unit/, component/, a11y/
│   └── e2e/                           specs/, fixtures/
│
├── backend/                           Node.js + TypeScript + Express
│   ├── gateway/                       PRIVACY GATEWAY — sole frontend entry point
│   │   └── src/                       routes, middleware, policies/{consent,purpose,rbac},
│   │                                  minimisation, rate-limit, audit, config
│   ├── services/                      each: src/{api,application,domain,
│   │   │                              infrastructure,events,jobs,config} + tests/
│   │   ├── auth-service/
│   │   ├── pseudonym-service/
│   │   ├── identity-vault-service/
│   │   ├── consent-service/
│   │   ├── community-service/
│   │   ├── moderation-service/
│   │   ├── care-therapy-service/
│   │   ├── therapist-service/
│   │   ├── clinical-vault-service/
│   │   ├── billing-subsidy-service/
│   │   ├── safety-crisis-service/
│   │   ├── break-glass-service/
│   │   ├── notification-service/
│   │   ├── audit-service/
│   │   ├── retention-service/
│   │   ├── admin-service/
│   │   └── partner-service/
│   ├── workers/                       post-expiry, retention, notification, payout,
│   │                                  search-index, audit-sealer, subsidy-reconciler
│   └── realtime/                      websocket-server/, media-sfu/
│
├── ai-services/                       Python + FastAPI
│   ├── orchestrator/                  each: app/{api,pipelines,models,guardrails,
│   ├── community-moderation/                config} + tests/
│   ├── therapist-insight/
│   ├── crisis-triage/
│   ├── security-abuse/
│   ├── subsidy-fraud/
│   ├── confidential-processing/       isolated decrypt → infer → re-encrypt → destroy
│   ├── shared/                        redaction, schemas, telemetry, prompting, inference
│   ├── on-device/                     classifier/, wasm-runtime/
│   ├── model-store/                   registry/, model-cards/, quantised/, weights/
│   └── evaluation/                    datasets, clinical-safety, language-bias,
│                                      red-team, false-positive-analysis, reports
│
├── packages/                          each: src/ + tests/
│   ├── shared-types/                  api-contracts/        validation-schemas/
│   ├── design-system/                 crypto-client/        crypto-utils/
│   ├── auth-utils/                    consent-policy-engine/ pricing-engine/
│   ├── pseudonym-kit/                 audit-client/         error-handling/
│   ├── observability/                 feature-flags/        i18n-core/
│   └── test-utils/                    config-eslint/        config-typescript/
│
├── metadata/                          DECLARATIVE SOURCE OF TRUTH — data, not code
│   ├── api/                           openapi/, asyncapi/, api-groups/, errors/
│   ├── data/                          dictionary/{identity,community,clinical,
│   │                                  billing,audit}, classification/, erd/, vault-map/
│   ├── consent/                       consent-types/, consent-versions/,
│   │                                  purpose-registry/, sharing-scopes/,
│   │                                  retention-policies/
│   ├── access-control/                roles/, permissions/, vault-access-matrix/,
│   │                                  step-up-actions/, break-glass-policy/
│   ├── moderation/                    categories/, decisions/, policy-versions/,
│   │                                  rewording-templates/, appeal-reasons/
│   ├── safety/                        risk-levels/, escalation-matrix/,
│   │                                  crisis-resources/, safety-plan-templates/,
│   │                                  grounding-scripts/
│   ├── ai/                            model-registry/, model-cards/, prompt-templates/,
│   │                                  ai-zones/, disclosure-strings/, insight-schemas/
│   ├── catalog/                       plans/, pricing/, subsidy-programmes/,
│   │                                  eligibility-rules/, community-categories/,
│   │                                  emotion-tags/, group-themes/, guided-activities/
│   ├── audit/                         event-types/, event-schema/, retention/
│   ├── notifications/                 templates/, channels/, privacy-safe-copy/
│   ├── compliance/                    dpdp-2025/, controls-matrix/, dpia/, ropa/,
│   │                                  grievance/, breach-playbook/, clinical-governance/
│   ├── i18n/                          locales/, glossary/, clinical-terms/
│   ├── routes/                        frontend/, navigation/
│   ├── generators/                    typescript/, python/, sql/
│   └── schemas/                       JSON Schema validating everything above
│
├── database/
│   ├── migrations/                    core/, identity-vault/, community-vault/,
│   ├── schemas/                       clinical-vault/, billing-vault/, audit-vault/
│   ├── seeds/                         reference-data/, demo/
│   ├── policies/                      row-level-security/, roles-grants/
│   ├── encryption/                    column-policies/, key-bindings/
│   ├── retention/jobs/
│   └── backup/runbooks/
│
├── infrastructure/
│   ├── docker/                        compose/, images/
│   ├── kubernetes/                    base/, overlays/{dev,staging,prod},
│   │                                  network-policies/
│   ├── terraform/                     modules/, environments/{dev,staging,prod}
│   ├── kms/                           key-hierarchy/, rotation-policies/
│   ├── secrets/                       templates/, sealed/          (no plaintext)
│   ├── networking/                    cdn/, waf/, dns/
│   ├── monitoring/                    prometheus/, grafana/, alerts/, slo/
│   ├── logging/                       pipelines/, redaction-rules/, siem/
│   ├── ci-cd/                         pipelines/, quality-gates/
│   ├── environments/
│   └── gpu-inference/
│
├── security/                          threat-models, policies, key-management,
│                                      pentest/{scope,reports}, vulnerability-management,
│                                      incident-response/playbooks, vendor-review,
│                                      sbom, compliance-evidence, privacy-reviews
│
├── tests/                             contract, integration, e2e, security, privacy,
│                                      accessibility, performance, ai-safety,
│                                      fixtures, factories, harness
│
├── resources/                         brand/, design/{tokens,figma-exports,wireframes},
│                                      content/{legal,community-guidelines,help-centre,
│                                      crisis-copy,onboarding-copy,ai-transparency-copy},
│                                      media/, fonts/, email-templates/
│
├── docs/                              product, architecture, frontend, backend, ai,
│                                      security, privacy, clinical, compliance,
│                                      operations, adr, runbooks, api, onboarding,
│                                      diagrams
│
├── ops/                               safety-operations, moderation-playbooks,
│                                      on-call, dashboards, support
│
├── tools/                             codegen/, lint-rules/, privacy-lint/, generators/
├── scripts/                           dev/, db/, release/, security/
└── .github/                           workflows/, ISSUE_TEMPLATE/
```

---

## The rules the structure enforces

**One entry point.** `frontend/` never reaches a database, a key, an emergency contact
record or a model. Every call lands on `backend/gateway/`, which runs authentication,
session validation, role check, consent check, purpose limitation, rate limit, data
minimisation, service authorization and audit — in that order.

**Vaults are separate directories because they are separate stores.** `database/` is
split by vault, and no cross-vault foreign keys exist. Identity, community, clinical,
billing and audit data are joined at the application layer by pseudo id, under a
consent check, never by a SQL join.

**Policy is data, not code.** Consent types, moderation categories, risk levels, plan
pricing, subsidy rules, audit event types and AI disclosure strings live in
`metadata/`. Services read them; they do not restate them. Consent texts and moderation
policies are append-only and versioned, because audit records reference the exact
version a user agreed to.

**One consent engine.** `packages/consent-policy-engine` is the only implementation of
"may this actor read this record for this purpose". A service that answers that
question locally is a bug.

**The AI tier is fenced.** `ai-services/` receives pseudonymous, minimised, consented
content only — never real names, phone numbers, payment data, emergency contacts,
government IDs, or unrelated history. `confidential-processing/` is the sole place
clinical plaintext exists, and only transiently.

**Audit is append-only and universal.** Every service writes through
`packages/audit-client` to `backend/services/audit-service`. Nothing deletes an audit
event.

**Privacy has a test suite.** `tests/privacy/` asserts the negatives — that moderators
cannot resolve identity, therapists cannot read unconsented records, partners see only
de-identified aggregates, and deletion actually purges primary store, object storage,
search index, cache and backups. It is a release gate.

---

## Where each portal lives

| Portal | Frontend | Backend |
| --- | --- | --- |
| Public website | `pages/public/` | `gateway/` + `community-service` (read-only) |
| Anonymous community | `pages/community/`, `features/community`, `features/moderation` | `community-service`, `moderation-service` |
| Member dashboard | `pages/dashboard/`, `features/{journal,mood,consent,privacy,data-rights}` | `clinical-vault-service`, `consent-service`, `retention-service` |
| Guided Group Care | `pages/group-care/`, `features/groups` | `care-therapy-service`, `realtime/` |
| One-to-one care | `pages/individual-care/`, `features/therapy` | `care-therapy-service`, `therapist-service`, `realtime/` |
| Therapist portal | `pages/therapist/`, `features/therapist-insights` | `therapist-service`, `ai-services/therapist-insight` |
| Moderator portal | `pages/moderator/` | `moderation-service` |
| Admin portal | `pages/admin/` | `admin-service`, `audit-service` |
| Partner portal | `pages/partner/`, `features/subsidy` | `partner-service`, `billing-subsidy-service` |
| Crisis / safety | `features/crisis`, `features/safety-plan` | `safety-crisis-service`, `break-glass-service`, `ops/safety-operations` |

---

## Build order

Follows the milestones in the architecture document.

1. **Foundation** — design system, routing, auth, passkeys, pseudonym service, basic
   pricing, privacy gateway, audit events.
2. **Anonymous community** — feed, composer, AI moderation, hidden replies, Interaction
   Plus, reports and appeals, five-day expiry.
3. **Care system** — therapist profiles, group care onboarding, one-to-one booking,
   session scheduling, consent service, clinical vault.
4. **AI and safety** — therapist-support AI, confidential processing, crisis workflow,
   break-glass case manager, human safety review queue.
5. **Admin, partner, compliance** — admin portal, moderator portal, partner subsidy
   portal, data export, deletion workflows, security monitoring, incident response.

The gateway, consent engine and audit client are milestone-1 work precisely because
every later milestone depends on them being non-optional.

---

## Open decisions

- **Workspace manager.** There is no root `package.json`, `pnpm-workspace.yaml` or
  `turbo.json` yet — `frontend/` currently carries its own. Pick pnpm workspaces +
  Turborepo or npm workspaces + Nx before the second package lands.
- **Design tokens.** The landing page's tokens live at
  `frontend/src/styles/tokens/tokens.css`. They are the de facto design system and
  should move to `packages/design-system/` once a second surface needs them.
- **Landing page content.** `frontend/src/content/site.ts` holds plan pricing,
  disclaimers and FAQ copy as a single module. Per the conventions in
  [folder-structure.md](docs/architecture/folder-structure.md), pricing belongs in
  `metadata/catalog/pricing/` and disclaimers in `metadata/ai/disclosure-strings/`.
  Left as-is deliberately — it is unlaunched marketing copy, not the runtime catalog.
  Split it when the backend starts serving plans.
- **The logo mark.** `components/layout/Nav.tsx` still draws the Unsaid mark — a
  closed mouth with a gold seam. Alaap means the opening utterance, which argues for
  a different mark.
- **Product vocabulary.** The name opens a naming system worth deciding on early:
  *riyaz* (daily practice), *baithak* (group sessions), *jugalbandi* (one-to-one),
  *sur* (mood). If you adopt it, it belongs in `metadata/i18n/glossary/` as
  user-facing copy — **not** in directory names, which stay functional and English.
- **Media provider.** `backend/realtime/media-sfu/` is a directory, not a choice —
  self-hosted SFU vs. managed WebRTC provider is still open, and it has privacy
  implications worth an ADR.
