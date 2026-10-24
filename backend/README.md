# backend

Node.js + TypeScript + Express. One privacy gateway, seventeen domain services,
background workers and the realtime tier.

## Layout

| Path | Holds |
| --- | --- |
| `gateway/` | Privacy Gateway — the only entry point the frontend may call |
| `services/` | Domain services, one folder each, hexagonal layout inside |
| `workers/` | Queue consumers: post expiry, retention, notifications, payouts, index sync, audit sealing |
| `realtime/` | WebSocket server and WebRTC SFU integration |

## Gateway contract

Every request passes, in order: authentication, session validation, role check,
consent check, purpose limitation, rate limit, data minimisation, service
authorization, audit event.

## Service boundaries

Services do not read each other's tables. Cross-service reads go through the owning
service's API, and any read of protected data carries a purpose string that the
consent engine evaluates.
