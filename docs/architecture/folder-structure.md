# Folder structure conventions

The tree itself is in the [root README](../../README.md). This document is the decision
guide: where new code goes, and what the naming means.

---

## Where does this code go?

| You are writing | It goes in |
| --- | --- |
| A new screen at a new route | `frontend/src/pages/<portal>/` + an entry in `metadata/routes/frontend/` |
| UI + state + API calls for one product capability | `frontend/src/features/<feature>/` |
| A component used by three or more features | `frontend/src/components/<category>/` |
| A component used by one feature | `frontend/src/features/<feature>/components/` |
| A new business capability with its own data | a new `backend/services/<name>-service/` |
| Logic that belongs to an existing capability | that service's `src/application/` |
| A pure rule with no I/O (pricing, eligibility, risk banding) | that service's `src/domain/`, or `packages/` if two services need it |
| A scheduled or queue-driven job | `backend/workers/<name>-worker/` if it runs independently, else the owning service's `src/jobs/` |
| Model inference or prompting | `ai-services/<zone>/app/pipelines/` |
| A policy, category list, price, consent text, risk level, template | `metadata/` — not code |
| A type shared by frontend and backend | generated into `packages/shared-types/` from `metadata/data/dictionary/` |
| A table | `database/schemas/<vault>/` + a migration + a dictionary entry |

**If you are about to hardcode a list, a threshold, a price, a category or a
user-facing policy string in a service, it belongs in `metadata/` instead.**

---

## Service internals

Every `backend/services/*` uses the same hexagonal layout, so a developer who knows one
service can read any of them:

```
src/
├── api/             HTTP handlers, DTOs, route registration. No business logic.
├── application/     Use cases. Orchestration, consent checks, transaction boundaries.
├── domain/          Entities, value objects, invariants. Zero I/O, zero imports from
│                    infrastructure. This layer is unit-testable with no fixtures.
├── infrastructure/  Repositories, vault clients, queue publishers, external adapters.
├── events/          Event contracts this service publishes and consumes.
├── jobs/            Scheduled work this service owns.
└── config/          Env schema and service configuration.
```

Dependency direction is inward: `api → application → domain`, and `infrastructure`
implements interfaces the `domain` declares. Nothing in `domain/` imports anything
outside `domain/`.

## Feature slice internals

Every `frontend/src/features/*` uses:

```
<feature>/
├── api/          TanStack Query hooks wrapping the generated client
├── components/   Components owned by this feature only
├── hooks/        Feature-local hooks
├── model/        Client state, selectors, derived values
├── schemas/      Zod schemas for this feature's forms
└── index.ts      The feature's public surface — other features import only from here
```

Features do not import from each other's internals. If two features need the same
thing, it moves up to `components/`, `hooks/` or `packages/`.

---

## Naming

- Directories: `kebab-case`, always. Including inside `metadata/`.
- Backend services: `<domain>-service`. Workers: `<job>-worker`.
- Vault directories match vault names exactly: `identity-vault`, `community-vault`,
  `clinical-vault`, `billing-vault`, `audit-vault`.
- Metadata files: `kebab-case.yaml`, versioned files as `<name>.v<n>.yaml`.
- React components: `PascalCase.tsx`, matching the component names in the frontend
  architecture document (`AnonymousPostComposer`, `ConsentTimeline`, `AIInsightReviewCard`).
- Nothing in a filename or directory name may describe a real user or a real case.

---

## Rules that are enforced, not just documented

These are checked by `tools/privacy-lint/` and CI, and they fail the build:

1. A service may not import a vault client outside its permitted set (§9.2 vault access
   matrix, mirrored in `metadata/access-control/vault-access-matrix/`).
2. A log or trace statement may not carry a field classified sensitive in
   `metadata/data/classification/`.
3. A request handler that reads protected data must declare a purpose string present in
   `metadata/consent/purpose-registry/`.
4. `frontend/` may not import from `backend/` or `database/`.
5. `domain/` may not import from `infrastructure/`.
6. A published consent version or moderation policy version may not be edited, only
   superseded.
7. Every `metadata/` file must validate against `metadata/schemas/`.

---

## Adding a new backend service

1. Copy the layout of an existing service.
2. Add its OpenAPI spec to `metadata/api/openapi/`.
3. Declare its vault permissions in `metadata/access-control/vault-access-matrix/`.
   A service with no entry gets no vault access.
4. Register its audit event types in `metadata/audit/event-types/`.
5. Add its tables to `database/schemas/<vault>/` and a data dictionary entry.
6. Write the service README: responsibilities, owned entities, boundary rule.
7. Add a contract test in `tests/contract/` and, if it touches protected data, a
   negative test in `tests/privacy/` and a review record in `security/privacy-reviews/`.
