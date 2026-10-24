# therapist-service

Therapist onboarding, credential verification, profiles, availability calendar, patient list, assigned care relationships, payout visibility, restricted access to consented user data.

## Owned entities

`therapist_profiles, therapist_credentials, therapist_verification_records, therapist_availability, therapist_payouts`

## Boundary rule

A therapist sees only assigned patients and only consented records.

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
