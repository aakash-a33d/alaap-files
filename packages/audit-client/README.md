# audit-client

The one way to write an audit event.

Extracted from the gateway so that seventeen services do not each grow their own
`INSERT` with their own idea of what belongs in `context` — the allowlist that keeps
content out of the audit vault only works if there is one of it.

---

## What must never reach the audit vault

Journal text, therapy transcripts, post or reply bodies, government ID numbers,
emergency contact details, authentication secrets, encryption keys, payment
credentials (§12P).

**An audit row records that an access happened, never what was read.**

`context` is filtered against `CONTEXT_ALLOWLIST` before insert. Anything not on the
list is dropped and counted, and non-scalar values are dropped even when their key is
allowlisted — a nested object is how content smuggles itself past a key check.

The allowlist is shared rather than per-service on purpose: a service needing a new
key has to add it here, where the addition is visible in review, instead of quietly
widening its own copy. `tests/audit-client.test.ts` asserts that no key naming content
or identity is ever on it, so an unsafe addition fails a build rather than being
discovered in an audit export.

---

## A failed write fails the operation it was recording

`write()` throws `AuditWriteError` rather than swallowing, and callers are expected to
abort. An unlogged sensitive access is not an acceptable outcome (§8).

The gateway does exactly this: a failed audit write becomes a 503 and the request is
never forwarded. That is a deliberate availability cost.

---

## Action types are derived, not written down

`gatewayActionType(prefix, method)` produces `gateway.<domain>.<verb>`.

It lives here because [`scripts/db/migrate.mjs`](../../scripts/db/migrate.mjs) derives
the **registered** event types from the same rule when it seeds `audit_event_types`.
Two copies would let the registry and the emitter disagree, and the failure mode is a
foreign key violation that — because a failed audit write fails the operation — takes
the request down with it.

---

## Known gaps

- **No integration test.** The context sanitiser and the action-type derivation are
  unit-tested; the actual `INSERT` is exercised only through the running gateway.
  A test against a live audit vault belongs in `tests/contract/`.
- **`riskScore` is never populated by any caller yet.** The column and the field exist
  for the crisis path, which arrives with safety-crisis-service.
- **No batching.** Each write is one round trip. That is correct while audit volume is
  bounded by request volume, and the hash-chain trigger serialises inserts anyway —
  batching would need the chain sharded per service first.

```bash
pnpm --filter @alaap/audit-client test
```
