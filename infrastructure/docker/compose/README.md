# Local development stack

Five containers: three PostgreSQL instances, Redis, OpenBao. Everything the backend
needs to run on one machine.

Not a production environment — see [`infrastructure/README.md`](../../README.md).

---

## Start

```bash
cp infrastructure/docker/compose/.env.example infrastructure/docker/compose/.env
docker compose -f infrastructure/docker/compose/compose.yaml up -d

# from the repository root, with .env sourced
node scripts/db/migrate.mjs
node scripts/db/verify.mjs
```

`migrate.mjs` applies schema, then grants, then audit event types, then login roles,
in that order. `verify.mjs` asserts the privilege boundaries hold — 33 checks, and
every negative one is a property the architecture depends on.

Audit event types are seeded from `metadata/audit/event-types/`, with the
`gateway.*` types **derived** from `metadata/api/api-groups/` using the same rule the
gateway applies. There is no hand-written seed, because a second copy of that list
would drift from the route policy it is supposed to mirror.

On Windows PowerShell, source the env with:

```powershell
Get-Content infrastructure\docker\compose\.env | Where-Object { $_ -match '^\w+=' } |
  ForEach-Object { $p = $_.Split('=',2); [Environment]::SetEnvironmentVariable($p[0], $p[1]) }
```

---

## What runs where

| Service | Port | Holds |
| --- | --- | --- |
| `postgres-shared` | 5432 | `core`, `community_vault`, `clinical_vault`, `billing_vault` |
| `postgres-identity` | 5433 | `identity_vault` — own instance, own network |
| `postgres-audit` | 5434 | `audit_vault` — own instance |
| `redis` | 6379 | Sessions, rate-limit counters, later BullMQ |
| `openbao` | 8200 | Key management, dev mode |

All bound to `127.0.0.1`, never `0.0.0.0`.

### Why three PostgreSQL instances and not one with six databases

Because the rule *"no cross-database joins; cross-vault reads go through the owning
service's API"* is only structurally true if the join is impossible. On one cluster
it is merely discouraged, and the first person in a hurry writes the join. On three
instances the query fails, which is the correct outcome and the one `verify.mjs`
asserts.

Idle footprint is roughly 150 MB.

---

## Roles

Group roles are `NOLOGIN` and defined in
[`database/policies/roles-grants/`](../../../database/policies/roles-grants/). Login
roles are created by `migrate.mjs` with passwords from the environment — **no
password appears in a migration**.

A service that owns tables gets **two** credentials: one on its vault instance, one
on the audit instance. The gateway appears only on audit, because audit append is its
single database credential — it owns no tables anywhere.

| Instance | Login role | Group |
| --- | --- | --- |
| shared | `auth_service_app` | `auth_service` |
| shared | `pseudonym_service_app` | `pseudonym_service` |
| shared | `community_service_app` | `community_service` |
| shared | `moderation_service_app` | `moderation_service` |
| audit | `gateway_audit` | `audit_writer` |
| audit | `<service>_audit` ×4 | `audit_writer` |
| audit | `audit_service_app` | `audit_service` |

---

## Common tasks

```bash
node scripts/db/migrate.mjs --status     # what is applied, changes nothing
node scripts/db/migrate.mjs --reset      # destroy volumes and rebuild — destructive
node scripts/dev/mint-session.mjs        # a dev session, until auth-service exists

docker compose logs -f postgres-shared
docker compose exec postgres-audit psql -U postgres -d audit_vault
docker compose down                      # stop, keep data
docker compose down -v                   # stop and destroy data
```

### Verifying the audit chain by hand

```sql
-- returns zero rows for an intact chain
SELECT * FROM audit_verify_chain();

SELECT seq, encode(prev_hash,'hex'), encode(row_hash,'hex')
FROM audit_events ORDER BY seq;
```

---

## Migrations are superseded, never edited

`migrate.mjs` records a SHA-256 per file. Editing an applied migration makes the
checksum disagree and the runner refuses to continue, because at that point the
database and the repository disagree about what is deployed. Add a new migration, or
`--reset` to rebuild.

---

## Known gaps after M1

- **No key material exists in OpenBao yet.** All five vaults have schema, and the
  sensitive tables carry `payload_ciphertext` / `payload_dek` / `key_id` columns —
  but no Transit key has been created, so nothing has been encrypted through the real
  path. The envelope-encryption contract is in the schema; exercising it is M7.
- **No service writes to any of these tables.** The vaults, roles and constraints are
  verified against psql. The seventeen services that would use them are still empty
  directories, so every route the gateway forwards to returns 502.
- **`therapist_*`, `therapy_*`, `appointments`, `insight_artifacts` and payouts are
  deliberately absent.** They belong to the care tiers, which arrive well after the
  first local run, and writing their schema now would mean guessing at decisions the
  clinical governance board has not made.
- **OpenBao runs in dev mode** — in-memory, auto-unsealed, fixed root token. No
  Transit key is configured yet; that arrives with the clinical vault in M7.
- **Network separation is documentary.** `postgres-identity` is on its own Docker
  network, but every port is published to `127.0.0.1` and the services run on the
  host, so nothing is actually prevented yet. It becomes real when the services are
  containerised and the published ports come off.
- **No backup or restore drill.** `database/backup/runbooks/` is empty.
