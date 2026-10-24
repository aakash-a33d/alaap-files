# partner-service

Subsidy partner and CSR programme management: fund balance, eligibility rules, active beneficiaries, allocation history, group sponsorship, NGO referral codes, CSR utilisation and de-identified outcome reporting.

## Owned entities

`partner_funds, subsidy_programs, subsidy_allocations, partner_reports, referral_codes`

## Boundary rule

Partners see de-identified aggregates only. Never therapy notes, journals, anonymous posts or emergency contacts.

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
