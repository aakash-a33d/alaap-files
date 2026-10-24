# break-glass-service

Creates restricted emergency cases, requires trained human review plus a second authorised approval and threshold approval, releases the minimum necessary emergency data, time-limits access, writes immutable audit logs, revokes access on case closure.

## Owned entities

`break_glass_cases, emergency_actions, identity_access_grants (read), emergency_access_logs`

## Boundary rule

Releases only: verified mobile number, emergency contact name and phone, assigned therapist contact if relevant, approximate city/state if necessary.

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
