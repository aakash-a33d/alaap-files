# consent-service

Records and withdraws consent, checks consent before any access, manages AI consent, therapist-sharing consent, recording consent and retention preferences, enforces consent-bound encryption policy.

## Owned entities

`consent_records, consent_versions, consent_withdrawals, record_access_policies, retention_preferences`

## Boundary rule

Every read of clinical or community data by another actor passes a consent check here first.

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
