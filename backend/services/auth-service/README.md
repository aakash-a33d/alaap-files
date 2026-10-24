# auth-service

Phone OTP registration, passkey registration and login, recovery codes, trusted devices, session creation and revocation, suspicious-login detection, step-up verification.

## Owned entities

`auth_accounts, passkey_credentials, trusted_devices, sessions, recovery_codes, login_events`

## Boundary rule

Never stores or reads clinical content. Holds the only link between a phone number and an account id.

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
