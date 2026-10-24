# database

PostgreSQL schema, migrations and access policy, organised by vault so that the
separation the architecture requires is visible in the filesystem.

| Path | Holds |
| --- | --- |
| `migrations/<vault>/` | Ordered migrations, one directory per vault |
| `schemas/<vault>/` | Current DDL, kept in sync with `metadata/data/dictionary` |
| `seeds/reference-data/` | Plans, categories, emotion tags — generated from `metadata/catalog` |
| `seeds/demo/` | Non-production demo data only |
| `policies/row-level-security/` | RLS policies enforcing per-record visibility |
| `policies/roles-grants/` | Per-service database roles; least privilege |
| `encryption/` | Column-level encryption policy and key-binding definitions |
| `retention/jobs/` | Retention and purge job definitions |
| `backup/runbooks/` | Encrypted backup and restore procedures |

Vaults: `core`, `identity-vault`, `community-vault`, `clinical-vault`,
`billing-vault`, `audit-vault`. No cross-vault foreign keys — vaults are joined by
pseudo id at the application layer, under a consent check.
