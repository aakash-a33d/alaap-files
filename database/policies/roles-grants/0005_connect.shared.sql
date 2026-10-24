-- Database CONNECT privileges — SHARED INSTANCE.
--
-- Closes a finding from the vault protection audit of 10 September 2026.
--
-- PostgreSQL grants CONNECT on a new database to PUBLIC by default, and the earlier
-- role files never revoked it. So any login role on this cluster could open a session
-- against any database on it. `REVOKE ALL ON ALL TABLES` meant no row was readable —
-- but `pg_catalog` is not permission-filtered the way `information_schema` is, so a
-- connected role could still enumerate table names.
--
-- Observed before this file: `community_service_app`, connected to `core`, listed
-- auth_accounts, login_events, passkey_credentials, recovery_codes, sessions and
-- trusted_devices. Column names did not resolve and row estimates returned -1, so the
-- leak was table names only — low severity, but it is the difference between
-- "separate database" and the strict access boundary §12B actually asks for.
--
-- Superusers bypass CONNECT, so the migration runner and the verifier keep working.
--
-- RESIDUAL, and deliberately not addressed here: `pg_roles` is readable by PUBLIC
-- from ANY database a role can reach, including its own, so the set of role names on
-- a cluster remains discoverable. Closing that needs a different mechanism than
-- database grants, and role names are not sensitive in the way table names are.

-- ===========================================================================
-- core — sole tenant
-- ===========================================================================

REVOKE CONNECT ON DATABASE core FROM PUBLIC;
GRANT  CONNECT ON DATABASE core TO auth_service;

-- ===========================================================================
-- community_vault — three co-tenants
-- ===========================================================================

REVOKE CONNECT ON DATABASE community_vault FROM PUBLIC;
GRANT  CONNECT ON DATABASE community_vault
    TO pseudonym_service, community_service, moderation_service;

-- ===========================================================================
-- clinical_vault — three co-tenants
-- ===========================================================================

REVOKE CONNECT ON DATABASE clinical_vault FROM PUBLIC;
GRANT  CONNECT ON DATABASE clinical_vault
    TO clinical_vault_service, consent_service, safety_crisis_service;

-- ===========================================================================
-- billing_vault — two co-tenants
-- ===========================================================================

REVOKE CONNECT ON DATABASE billing_vault FROM PUBLIC;
GRANT  CONNECT ON DATABASE billing_vault
    TO billing_subsidy_service, partner_service;

-- `postgres` is left as it is. It holds the migration ledger and is reached only by
-- superusers; revoking PUBLIC there would close nothing that matters, because role
-- names leak from any reachable database rather than from that one.
