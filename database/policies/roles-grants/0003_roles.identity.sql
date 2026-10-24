-- Per-service database roles — IDENTITY INSTANCE (identity_vault).
--
-- The narrowest grant set on the platform. Two services, both in the
-- identity-isolate deployable, both declaring api_groups: [] so the frontend can
-- never reach them — and the gateway refuses at boot to route to a service that does.
--
-- No community, moderation, billing or clinical role exists on this instance at all.
-- Absence is denial, and here it is the whole design: a compromised community service
-- holds no credential that means anything on this cluster.

-- ===========================================================================
-- Cluster roles
-- ===========================================================================

CREATE ROLE identity_vault_service NOLOGIN;
CREATE ROLE break_glass_service    NOLOGIN;

-- ===========================================================================
-- identity-vault
-- ===========================================================================
\connect identity_vault

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO identity_vault_service, break_glass_service;

-- identity-vault-service: the records, and the request/grant machinery around them.
GRANT SELECT, INSERT, UPDATE ON
    identity_vault_records, emergency_contacts, care_verification_records,
    identity_consent_records, identity_access_requests, identity_access_grants
    TO identity_vault_service;
GRANT SELECT ON identity_tiers TO identity_vault_service;

-- No DELETE. Erasure runs through the retention workflow, which sets erasure_due_at
-- and lets a reviewed job purge — so a bug in a request handler cannot destroy an
-- identity record, and a deletion always leaves evidence it happened.

-- break-glass-service: opens and drives cases. It may READ the identity record it
-- has been granted access to, and it may never write one.
GRANT SELECT, INSERT, UPDATE ON
    break_glass_cases, break_glass_reviews, threshold_approvals, emergency_actions
    TO break_glass_service;
GRANT SELECT ON break_glass_threshold_status TO break_glass_service;
GRANT SELECT ON identity_vault_records, emergency_contacts TO break_glass_service;
GRANT SELECT, INSERT ON identity_access_requests TO break_glass_service;
GRANT SELECT, INSERT ON identity_access_grants TO break_glass_service;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
    TO identity_vault_service, break_glass_service;

-- Explicitly withheld, each because it was tempting:
--   break_glass_service      has no UPDATE on identity_vault_records
--                            — an emergency may read a name, never rewrite one
--   break_glass_service      has no DELETE anywhere
--                            — a case cannot erase its own trail
--   identity_vault_service   has no write on break_glass_cases
--                            — the service holding the data cannot authorise its own
--                              disclosure, which is the entire point of the split
