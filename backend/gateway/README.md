# gateway

The Privacy Gateway. The only entry point the frontend may call, and the only thing
permitted to assert who a caller is.

Owns no tables. Holds no vault credentials except `INSERT` on `audit_events`. A
gateway compromise yields no protected data directly — that property is stated in
[`metadata/access-control/vault-access-matrix/`](../../metadata/access-control/vault-access-matrix/vault-access.v1.yaml)
and this service is built to keep it true.

---

## The pipeline

Order fixed by [`backend/README.md`](../README.md), asserted in
[`src/app.ts`](src/app.ts):

| # | Stage | Where |
| --- | --- | --- |
| 0 | Request id, **trust-header strip**, IP truncation | `middleware/request-context.ts` |
| 0b | Route policy resolution — absence is denial | `routes/table.ts` |
| 1,2 | Authentication and session validation | `middleware/authenticate.ts` |
| 3 | Role check and step-up assertion | `policies/rbac/` |
| 4 | Coarse consent classification | `policies/consent/` |
| 5 | Purpose limitation | `policies/purpose/` |
| 6 | Rate limit — anti-abuse, **not** plan quota | `rate-limit/` |
| 7 | Data minimisation (request side) | `minimisation/` |
| 8 | Audit event, **before** forwarding | `audit/` |
| 9 | Service authorization and proxy | `routes/proxy.ts` |

### Three decisions worth knowing before you change anything

**The trust-header strip is the load-bearing line.** Downstream services trust
`x-alaap-*` headers to carry the caller's identity, because the gateway is the only
thing that sets them. `request-context.ts` deletes every inbound `x-alaap-*` header
before anything else runs. Without it, a client sends its own `x-alaap-pseudo-id` and
acts as any member on the platform. Everything else here is defence in depth.

**The audit event is written before the proxy, not after the response.**
`backend-requirements` §8 says audit writes must not block the request path *and*
that a failed audit write fails the operation it recorded. Those reconcile only if
the event records the gateway's **access decision**, which is known before anything
is forwarded. Auditing after the response would make the second rule unenforceable —
the data would already have been served. The cost is that an audit vault outage
returns 503 on sensitive routes. That is deliberate: an unlogged sensitive access is
not an acceptable outcome.

**Rate limit is not plan quota.** The gateway limits *abuse* — short window, per
session or truncated IP prefix. It does not enforce "four posts a month", because
that is an entitlement decision needing a plan tier, and the gateway holds no billing
credentials. Quota lives in
[`metadata/catalog/plans/`](../../metadata/catalog/plans/plans.v1.yaml) and is
enforced by `community-service`.

---

## Policy is metadata, not code

There is no route table in this codebase. The gateway reads three files at boot,
validates each against its JSON Schema, and cross-checks them against one another:

| File | Supplies |
| --- | --- |
| `metadata/api/api-groups/api-groups.v1.yaml` | Route policy: upstream, roles, purpose, audit level, step-up |
| `metadata/api/service-registry.v1.yaml` | Which service claims which API group |
| `metadata/consent/purpose-registry/purposes.v1.yaml` | Every purpose a route may declare |

**Every cross-check failure is fatal.** A gateway that starts with an inconsistent
route policy is worse than one that refuses to start, because the inconsistency
surfaces later as a route that is silently unreachable — or silently reachable. The
checks in `config/metadata.ts` refuse startup when:

- a group names a service the registry does not have, or that does not claim the prefix
- a group routes to a service declaring `api_groups: []` (`identity-vault-service`
  and `audit-service` are internal-only and must never be frontend-reachable)
- a group declares a purpose absent from the purpose registry
- a group is audited but declares no purpose — `audit_events.purpose` is `NOT NULL`
- an authenticated group permits no role, and is therefore unreachable
- a service claims a prefix with no policy
- anything routes to the gateway itself

---

## What the gateway deliberately does not decide

Per `backend-requirements` §9, the consent decision is split. The gateway makes the
coarse call; the owning service makes the record-level one.

The gateway cannot know whether therapist `T-982` is assigned to journal `J-3912`,
whether the user shared *that* record, whether the grant expired, or whether the
retention window still holds. Enforcing only here would be a correctness bug
disguised as a security boundary. `policies/consent/` therefore classifies and
records rather than adjudicates, and the classification is what lands in
`audit_events.consent_decision`.

When `packages/consent-policy-engine` exists, the record-level evaluation goes there
and is called by owning services. This stage does not change.

---

## Known gaps

Recorded rather than hidden.

- **Response-side minimisation is inert.** `minimisation/minimiseResponse` is wired
  into the proxy and passes bodies through untouched, because trimming a response to
  the fields a route may return needs per-route schemas from
  `metadata/api/openapi/`, which is empty. Until then a service that over-returns
  over-returns through the gateway — the owning service is currently the only thing
  between a caller and a field it should not see.
- **Service-to-service auth is an HMAC over the identity headers.** MVP mechanism.
  mTLS between deployables should replace it before `identity-isolate` carries real
  records: a shared secret distributed to fifteen services is a weaker boundary than
  the network segment it protects. Needs an ADR.
- **`policies/purpose/SERVICE_VAULTS` duplicates the vault access matrix.** The
  gateway needs only the coarse service→vault mapping, so it is restated rather than
  loaded. `tests/privacy/` should assert the two stay in agreement; that test does
  not exist yet.
- **`rate-limit` fails open when Redis is down**, while session lookup fails closed.
  The asymmetry is intentional — an unverifiable session is a security question, an
  uncountable request is a capacity one — but it means a Redis outage removes abuse
  protection from unauthenticated routes.
- **No audit event types are registered yet.** `metadata/audit/event-types/` is
  empty, and `audit_events.action_type` references `audit_event_types(id)`. The
  gateway emits `gateway.<domain>.<verb>`; those rows must be seeded before any
  audited route works against a real database.

---

## Running it

```bash
pnpm install
cp backend/gateway/.env.example backend/gateway/.env
pnpm --filter @alaap/gateway dev
```

Needs Redis for sessions and rate limiting, and the audit vault database for audited
routes. Unaudited routes work without Postgres. `GET /healthz` needs neither.

```bash
pnpm --filter @alaap/gateway typecheck
pnpm --filter @alaap/gateway test
```

The tests run against the real `metadata/` files rather than fixtures, so they fail
when someone edits a YAML file into an inconsistent state — which is the whole point.
