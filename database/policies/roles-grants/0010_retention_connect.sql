-- CONNECT for retention-service, on core and nowhere else.
--
-- A separate file because 0009 is already applied and the migration ledger stores a
-- checksum per file — editing an applied one is refused, which is the behaviour that
-- makes "these are the privileges that were granted" a question with an answer.
--
-- The absence here is the design. retention-service deletes across five vaults and can
-- open exactly one database: `core`, where its four bookkeeping tables live. It cannot
-- CONNECT to community_vault, clinical_vault, billing_vault or the identity instance at
-- all, so the purge-only constraint in the vault access matrix is enforced by the
-- database rather than by the service remembering to behave.
--
-- Matrix: metadata/access-control/vault-access-matrix/vault-access.v1.yaml

\connect postgres

GRANT CONNECT ON DATABASE core TO retention_service;

-- Not granted, deliberately:
--   REVOKE is unnecessary — a role starts with no CONNECT once PUBLIC is revoked in
--   0005_connect.shared.sql, so silence here is denial for every other database.
