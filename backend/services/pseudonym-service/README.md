# pseudonym-service

Generates numeric pseudo-user IDs and rotating public handles, manages avatars/identicons, keeps public identity separate from private identity, prevents search by real identity, manages block lists.

## Owned entities

`pseudo_profiles, public_handles, avatar_profiles, block_lists, pseudonym_rotation_logs`

## Boundary rule

Must not resolve a pseudo id back to a real identity for any caller except an approved break-glass workflow.

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
