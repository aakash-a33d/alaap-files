# clinical-vault-service

Stores journals, mood logs, therapy notes, AI insight artifacts and approved attachments. Enforces per-record visibility, supports client-side encrypted records, therapist-approved access and secure deletion.

## Owned entities

`journal_entries, mood_checkins, therapist_notes, insight_artifacts, attachment_metadata, clinical_record_access_policies`

## Boundary rule

Record visibility: Private to User / Shared with Therapist / Shared with Group Therapist / AI-Analysis Allowed / Temporary Analysis Only / Emergency Restricted / Deleted-Pending Purge.

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
