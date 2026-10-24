# admin-service

Plan creation, subsidy configuration, therapist verification, moderator oversight, audit review, data export and deletion request management, incident monitoring, security alerts.

## Owned entities

`admin_action_logs, incident_records, data_request_records, system_health_snapshots`

## Boundary rule

Must not provide casual access to identity, journals, therapy content or emergency contact records.

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
