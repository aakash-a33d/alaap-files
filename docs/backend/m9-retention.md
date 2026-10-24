# M9 — export and deletion

**Delivers:** retention-service, and the step-up verification without which it cannot be reached.
**Done when:** a member deletes their account and a privacy suite proves the data is gone.

This is the last milestone before the first local run, and the one where the platform's
central promise is either true or it isn't. Everything before it was about not collecting
more than necessary. This is about giving it all back, and then destroying it.

---

## 0. The prerequisite nobody has noticed yet

`/api/data-rights` is declared in the route policy with `step_up: true`. The gateway
checks `steppedUpAt` and `steppedUpScope` on the session record. **Nothing in the
codebase ever sets them.**

Verified against the running stack: an ordinary route returns 200 for a fresh session,
and `/api/data-rights/export` returns `403 step_up_required` — for everyone, forever.
The same is true of `/api/admin` and `/api/break-glass`.

This is the same shape as the session cookie the gateway read but nobody issued: a
control that is enforced and unsatisfiable. So M9 begins with step-up:

| endpoint | does |
|---|---|
| `POST /api/auth/step-up/start` | sends an OTP to the number on the account |
| `POST /api/auth/step-up/verify` | on success, stamps the session with a scope and a time |

The assertion is **scoped** — to `/api/data-rights`, not to "sensitive things" — and
expires in 15 minutes, independently of the session. A step-up for "export my data" must
not unlock break-glass, which is why the scope is the route prefix and the gateway
compares it exactly.

It is written by the gateway, not by auth-service. auth-service verifies the code and
says who it was; the gateway holds the session store and is the only thing that can
amend a live session — the same reasoning that put logout there.

---

## 1. retention-service holds no vault credentials

From the vault access matrix, already decided:

```yaml
- service: retention-service
  access:
    identity:  { direct: none, effective: limited, constraint: purge-only }
    community: { direct: none, effective: limited, constraint: purge-only }
    clinical:  { direct: none, effective: limited, constraint: purge-only }
    billing:   { direct: none, effective: limited, constraint: purge-only }
    audit:     { direct: append, effective: none }
```

A service with DELETE on every vault would be the most dangerous account in the system —
one compromised credential, and every member's history is gone. Instead each owning
service exposes `/internal/purge` and `/internal/export`, and retention-service
orchestrates. The service that owns a vault is also the one that knows its foreign keys,
its legal holds and its encryption.

retention-service owns four tables of its own in `core`: `data_deletion_requests`,
`retention_jobs`, `export_requests`, `deletion_audit_logs`.

**Driven from a Postgres outbox, not a queue.** A deletion request that survives only in
Redis is a deletion that silently does not happen after a restart — and the member was
told it would. Each vault is a row with its own state, so a crash halfway through resumes
rather than restarts.

---

## 2. What deletion means, vault by vault

| vault | what goes | what stays |
|---|---|---|
| identity | the mobile number and its link to the pseudonym | nothing |
| core | account, sessions, devices, recovery codes | nothing |
| community | posts, replies, reports, appeals | records under legal hold (§4) |
| clinical | journals, mood check-ins, consent records | nothing |
| billing | subscription and payment rows | subsidy claim evidence, if a scheme requires it |
| audit | **nothing** | the whole trail (§3) |

**Encryption needs no separate step.** A journal entry's data key is wrapped and stored
in the same row as its ciphertext. Delete the row and the key goes with it, which leaves
the ciphertext unrecoverable by anyone including us. There is no per-member Transit key
to destroy — the key is per vault, and destroying it would destroy every member's
entries, not one's.

**Replies to other people are deleted too.** This is a real cost and worth naming: a
reply that helped somebody disappears from their thread. The member wrote those words,
their right to erasure is the stronger claim, and a tombstone reading "deleted by author"
would still disclose that a particular person had been there. Threads expire in five days
regardless.

---

## 3. The audit vault is the exception, and the member is told why

The audit trail is append-only and hash-chained. It is not purged, and a member who asks
for everything to be deleted deserves that stated plainly rather than discovered later.

Three reasons, in the order that matters to the person asking:

1. **It is how the deletion is proved.** `data_rights.deletion.completed` is retained
   permanently precisely so that "did they actually delete it?" has an answer. Destroying
   the evidence of destruction leaves the member with nothing but our word.
2. **It holds no content.** The audit client's context allowlist keeps bodies, titles,
   word counts and mood scores out of the vault. A row says an access happened, by whom,
   for what purpose, and with what result.
3. **After identity is severed it points at nobody.** The rows are keyed by pseudonym.
   Once the identity vault's link to the mobile number is destroyed, there is no path from
   a pseudo id back to a person — the separation that makes this survivable is the same
   separation the architecture is built on.

The deletion receipt says this in the member's own words, not in a policy page.

---

## 4. Legal hold, said out loud

A post retained for an appeal or an abuse investigation carries `legal_hold`. It is not
purged with the rest.

The honest handling is not to hide it: everything else is deleted immediately, the
request stays open against the held records, and the member is told **which records, why,
and that the rest is gone.** A deletion reported as complete while records survive is a
lie the audit trail would eventually expose; a deletion that blocks entirely on one held
post punishes the member for someone else's appeal.

---

## 5. Export

`GET /api/data-rights/export` returns everything the member wrote, as JSON:

- posts, with their replies **from others removed** — other people's words are not the
  member's data to take
- their own replies, each with the reference of the post it answered but not its text
- journal entries, decrypted, and mood check-ins
- consent records, including withdrawals, with the version text they agreed to
- handle, plan, and the dates that bound the account

Not included: the audit trail (it is about them but not written by them, and it names
staff and services), and anything another member wrote.

Every export writes `data_rights.export.delivered` at sensitivity 5. An entire account's
contents leaving the platform is the single largest disclosure it performs, and it should
be the loudest row in the vault.

---

## 6. Acceptance

`scripts/dev/retention-flows.mjs` plus `tests/privacy/`:

1. Step-up is required, and a fresh session is refused with `step_up_required`.
2. After verifying, the same session reaches `/api/data-rights` — and **only** that
   prefix; a step-up for data-rights does not unlock `/api/admin`.
3. The assertion expires; the route refuses again.
4. Export contains the member's own posts, replies, journals, mood and consents, and
   contains no other member's text.
5. Deletion returns a receipt naming every vault and what happened in each.
6. **Read the databases directly, as superuser, past every service:** no row in identity,
   core, community or clinical carries that pseudonym.
7. The audit rows survive, and `data_rights.deletion.completed` is among them.
8. The member's handle cannot be resolved, and their session is dead.
9. A post under legal hold survives, is reported, and does not block the rest.
