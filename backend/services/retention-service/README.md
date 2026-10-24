# retention-service

Expires free posts after five days, deletes hidden replies after their retention period, purges deleted journals, deletes AI-derived summaries on request, handles account closure, processes exports, manages backup lifecycle deletion, removes search index entries, anonymises analytics.

## Owned entities

`data_deletion_requests, retention_jobs, export_requests, deletion_audit_logs`

## Boundary rule

Deletion must reach primary store, object storage, search index, cache and backups.

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
