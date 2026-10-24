# care-therapy-service

Group therapy enrolment and matching, one-to-one booking, session scheduling, care relationship management, therapist tasks, group spaces, session summaries, care-plan progress.

## Owned entities

`therapy_groups, group_memberships, group_sessions, session_participants, care_relationships, appointments, therapy_tasks, session_summaries`

## Boundary rule

Clinical content is read through the Clinical Vault under a consent check, never cached locally.

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
