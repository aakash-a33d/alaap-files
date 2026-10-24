# moderation-service

Calls AI moderation, applies rules-based filters, detects personal-data leaks, toxic/coercive/harmful content, scams and malware links, produces a moderation verdict, sends high-risk signals to Safety and Crisis, routes unclear cases to human review.

## Owned entities

`moderation_verdicts, moderation_categories, moderation_reviews, moderation_appeals, moderation_policy_versions`

## Boundary rule

Verdicts are Allowed / Suggest Rewording / Limited Visibility / Blocked / Crisis Flag / Abuse Pattern.

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
