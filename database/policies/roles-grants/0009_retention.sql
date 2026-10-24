-- retention-service grants.
--
-- Appended rather than folded into 0001_roles.shared.sql: the migration ledger stores
-- a checksum per file and refuses one that changed after it was applied. A privilege
-- change is a new file, always.
--
-- THE POINT OF THIS FILE IS WHAT IS ABSENT.
--
-- retention-service deletes a member's entire history across five vaults and holds a
-- grant on none of them. It owns four tables in `core` and nothing else. Every purge
-- goes through the owning service's endpoint, which means:
--
--   * a compromised retention-service credential reaches four bookkeeping tables,
--     not every member's journal
--   * the service that knows a vault's foreign keys, legal holds and encryption is
--     the one that deletes from it
--   * "delete everything" is a conversation between services, each of which audits
--     its own half, rather than one role quietly issuing DELETE across the estate
--
-- Matrix: metadata/access-control/vault-access-matrix/vault-access.v1.yaml
--         retention-service: { identity|community|clinical|billing: direct none,
--                              constraint purge-only; audit: append }

CREATE ROLE retention_service NOLOGIN;

\connect core

GRANT USAGE ON SCHEMA public TO retention_service;

GRANT SELECT, INSERT, UPDATE ON
    data_deletion_requests, retention_jobs, export_requests
    TO retention_service;

-- INSERT and SELECT only. A receipt that its writer can amend is not a receipt, and
-- the row survives the request it describes (ON DELETE RESTRICT).
GRANT SELECT, INSERT ON deletion_audit_logs TO retention_service;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO retention_service;

-- Explicitly NOT granted, and each one is load-bearing:
--
--   auth_accounts, sessions, trusted_devices, recovery_codes   auth-service purges
--   community_posts, community_comments                        community-service purges
--   journal_entries, mood_checkins, consent_records            clinical/consent purge
--   pseudo_profiles, public_handles                            pseudonym-service purges
--
-- If a future change grants retention-service direct DELETE on any of those, the
-- verification suite's negative cases will start passing where they should fail.
