# metadata

The declarative source of truth. Everything here is data, not code: YAML and JSON that
both the frontend and the backend read or that code generation consumes. Changing a
policy should mean editing a file here, not hunting through services.

| Path | Owns |
| --- | --- |
| `api/` | OpenAPI per service, AsyncAPI for queue events, API group registry, error catalog |
| `data/` | Field-level data dictionary per vault, PII classification tiers, ERDs, vault map |
| `consent/` | Consent types, versioned consent texts, purpose registry, sharing scopes, retention policies |
| `access-control/` | Roles, permissions, the vault access matrix, step-up-required actions, break-glass policy |
| `moderation/` | Categories, decision types, versioned policies, rewording templates, appeal reasons |
| `safety/` | Risk levels, escalation matrix, regional crisis resources, safety plan templates, grounding scripts |
| `ai/` | Model registry, model cards, prompt templates, AI zone definitions, disclosure strings, insight schemas |
| `catalog/` | Plans, pricing, subsidy programmes, eligibility rules, community categories, emotion tags, group themes, guided activities |
| `audit/` | Audit event types and schema, audit retention |
| `notifications/` | Templates, channels, the privacy-safe copy rules |
| `compliance/` | DPDP 2025 mapping, controls matrix, DPIA, ROPA, grievance process, breach playbook, clinical governance |
| `i18n/` | Locale registry, glossary, clinical term translations |
| `routes/` | Frontend route registry and navigation trees, kept in sync with the router |
| `generators/` | Codegen: metadata to TypeScript types, Zod schemas, Pydantic models, SQL |
| `schemas/` | JSON Schema files that validate everything else in this directory |

## Rules

- Every file here is versioned and reviewed. Consent texts and moderation policies are
  append-only — add a new version, never edit a published one, because audit records
  reference the version a user actually agreed to.
- CI validates this directory against `metadata/schemas/` before anything else runs.
- No secrets, no credentials, no personal data. Ever.
