# audit-service

Logs sensitive access, consent changes, therapist access, moderator actions, AI access, identity-vault access, emergency break-glass actions, and data export or deletion requests to the immutable audit vault.

## Owned entities

`audit_events, audit_event_hashes, admin_action_logs, therapist_access_logs, emergency_access_logs, ai_access_logs`

## Boundary rule

Event fields: request_id, pseudo_id, actor_id, actor_role, service_name, action_type, purpose, consent_decision, access_result, timestamp, risk_score. Append-only.

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
