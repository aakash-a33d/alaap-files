# notification-service

OTP messages, emergency contact verification links, session reminders, therapist task reminders, subsidy status updates, moderation decision notices, privacy-safe push/email/SMS.

## Owned entities

`notification_templates, notification_deliveries, channel_preferences`

## Boundary rule

Notifications must never expose sensitive content. Say 'A private update is ready in your account', never the subject of the update.

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
