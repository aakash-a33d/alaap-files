# identity-vault-service

Stores protected care identity, emergency contacts, subsidy identity documents and care-verification status. Exposes identity only to authorised workflows, supports break-glass access, encrypts records with KMS/HSM keys.

## Owned entities

`identity_vault_records, emergency_contacts, care_verification_records, identity_access_requests, identity_access_grants`

## Boundary rule

Must not expose identity to the community service, moderators, AI moderation, peer users, partner dashboards, or normal admin search.

## Layout

```
src/
├── api/             HTTP handlers, request/response DTOs, route registration
├── application/     use cases; orchestration; consent + purpose checks
├── domain/          entities, value objects, invariants — no I/O
├── infrastructure/  repositories, vault clients, external adapters
├── events/          published and consumed queue events
├── jobs/            scheduled work owned by this service
└── config/          service configuration and env schema
tests/               unit + integration tests for this service
```
