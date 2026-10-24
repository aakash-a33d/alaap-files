# community-service

Anonymous post creation, categories, post expiry, replies, hidden replies, free-plan limits, hidden-reply unlock after Interaction Plus upgrade, reports, blocks and appeals.

## Owned entities

`community_posts, community_comments, post_visibility_rules, hidden_replies, community_categories, user_reports, moderation_appeals, account_restrictions`

## Boundary rule

Receives pseudonymous content only. Has no path to the Identity Vault or Clinical Vault.

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
