# billing-subsidy-service

Plan management, subscription billing, payment gateway integration, invoices, subsidy programme management, partner fund allocation, therapist payout calculation, refunds, hidden-reply unlock after upgrade.

## Owned entities

`plans, subscriptions, payments, invoices, subsidy_programs, subsidy_allocations, partner_funds, therapist_payouts, refunds`

## Boundary rule

Pricing is: standard price - applicable subsidy = user payable amount. Stores subsidy source, eligibility rule, approval method, expiry, slots and contributions. Holds no clinical data.

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
