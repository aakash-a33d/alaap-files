-- Per-service database roles — AUDIT INSTANCE (audit_vault).
--
-- Split from the single-cluster 0001_roles.sql: the audit vault is a dedicated
-- instance (backend-requirements §2, §8) and roles are cluster-scoped, so it needs
-- its own role definitions rather than a `\connect` from the shared cluster.
--
-- Every service holds TWO connection strings: one to the vault instance it owns
-- tables in, and one here. The gateway holds only this one — it owns no tables
-- anywhere, and audit append is its single database credential.

-- ===========================================================================
-- Cluster roles
-- ===========================================================================

-- Held by every service. INSERT on audit_events and nothing else.
CREATE ROLE audit_writer   NOLOGIN;

-- The read and sealing paths. Still no UPDATE or DELETE.
CREATE ROLE audit_service  NOLOGIN;

-- ===========================================================================
-- audit-vault — append-only for everyone except audit-service
-- ===========================================================================
\connect audit_vault

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO audit_writer, audit_service;

-- INSERT only. No SELECT: a service cannot read back the log it writes to,
-- so a compromised service cannot enumerate who accessed what.
--
-- The chain trigger still has to read the preceding row_hash to extend the chain.
-- That works because audit_chain_link() is SECURITY DEFINER and owned by the
-- migration role, so it runs with the owner's read rights rather than the writer's.
-- Both properties hold at once, which is the whole point of that declaration.
GRANT INSERT ON audit_events TO audit_writer;
GRANT USAGE, SELECT ON SEQUENCE audit_events_seq_seq TO audit_writer;
GRANT SELECT ON audit_event_types TO audit_writer;

-- audit-service holds the read and sealing paths. Still no UPDATE or DELETE
-- on audit_events — the immutability trigger would refuse it regardless.
GRANT SELECT ON audit_events TO audit_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_event_types TO audit_service;
GRANT SELECT, INSERT ON audit_event_hashes TO audit_service;
GRANT EXECUTE ON FUNCTION audit_verify_chain(bigint, bigint) TO audit_service;

-- Login roles and their audit_writer grants are created by scripts/db/migrate.mjs.
--
-- The gateway is included there and was absent from the original file — an omission
-- rather than a decision: it writes an audit event for every access decision on a
-- sensitive route, and a failed write fails the operation it was recording, so
-- without this grant every audited route returns 503.
