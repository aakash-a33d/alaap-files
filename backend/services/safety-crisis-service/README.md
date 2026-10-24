# safety-crisis-service

Receives crisis signals, classifies low/moderate/high risk, serves grounding support, notifies therapists when appropriate, creates safety cases, manages the human reviewer queue, triggers break-glass only when justified.

## Owned entities

`safety_signals, risk_assessments, break_glass_cases, emergency_actions, safety_reviewer_actions`

## Boundary rule

AI cannot directly contact police, NGOs, family or emergency contacts. High risk always requires human review plus a second approval.

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
