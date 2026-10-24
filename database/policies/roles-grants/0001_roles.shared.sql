-- Per-service database roles — SHARED INSTANCE (core, community_vault).
-- Least privilege.
--
-- Supersedes the single-cluster 0001_roles.sql. That file used `\connect audit_vault`
-- alongside `\connect core`, which assumes one cluster; backend-requirements §2 puts
-- Audit and Identity on dedicated instances, and a role is cluster-scoped. The grants
-- below are unchanged — only the file boundary moved, so each instance gets exactly
-- the roles it can actually hold.
--
-- The invariant this file enforces, which nothing in application code can:
--   * a service holds credentials only to the tables it owns
--   * a vault may be co-tenanted, but co-tenants cannot read each other's tables
--
-- Login roles are NOT created here. These are NOLOGIN group roles; scripts/db/migrate.mjs
-- creates the login roles and grants them these groups, with passwords from the
-- environment. No password ever appears in a migration.
--
-- Reasoning: docs/backend/backend-requirements.md §2, §8
-- Matrix:    metadata/access-control/vault-access-matrix/vault-access.v1.yaml

-- ===========================================================================
-- Cluster roles
-- ===========================================================================

CREATE ROLE auth_service        NOLOGIN;
CREATE ROLE pseudonym_service   NOLOGIN;
CREATE ROLE community_service   NOLOGIN;
CREATE ROLE moderation_service  NOLOGIN;

-- ===========================================================================
-- core
-- ===========================================================================
\connect core

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO auth_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON
    auth_accounts, passkey_credentials, recovery_codes,
    trusted_devices, sessions, login_events
    TO auth_service;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO auth_service;

-- No other service has any grant here. Absence is denial.

-- ===========================================================================
-- community-vault — co-tenanted over disjoint table sets
-- ===========================================================================
\connect community_vault

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO pseudonym_service, community_service, moderation_service;

-- pseudonym-service: the public persona, and nothing about its content
GRANT SELECT, INSERT, UPDATE, DELETE ON
    pseudo_profiles, public_handles, pseudonym_rotation_logs, block_lists
    TO pseudonym_service;

-- community-service: posts and replies. Reads personas, cannot mutate them.
GRANT SELECT ON pseudo_profiles, public_handles, block_lists TO community_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON
    community_posts, community_comments, post_visibility_rules,
    community_categories, user_reports, account_restrictions
    TO community_service;

-- moderation-service: verdicts and appeals. Reads content to moderate it,
-- and may transition post/comment state to apply a decision.
GRANT SELECT ON pseudo_profiles, public_handles TO moderation_service;
GRANT SELECT, UPDATE (state) ON community_posts, community_comments TO moderation_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON
    moderation_verdicts, moderation_reviews, moderation_appeals,
    moderation_categories, moderation_policy_versions
    TO moderation_service;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
    TO pseudonym_service, community_service, moderation_service;

-- Explicitly withheld, and worth stating because each was tempting:
--   community_service  has no write on pseudo_profiles  — cannot forge a persona
--   moderation_service has no write on post bodies      — cannot edit what it judges
--   pseudonym_service  has no read on post bodies       — cannot link persona to content

-- ===========================================================================
-- clinical_vault, billing_vault
-- ===========================================================================
-- No roles yet. The schemas arrive in M7 and their grants arrive with them. A
-- database with no grants is unreachable, which is the correct state for a vault
-- whose tables do not exist.
