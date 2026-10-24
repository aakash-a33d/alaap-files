-- Per-service database roles — SHARED INSTANCE, clinical_vault and billing_vault.
--
-- Applied after 0001_roles.shared.sql, which created the cluster roles for core and
-- the community vault on this same instance. This file adds the roles those two
-- vaults need and nothing else.
--
-- Both vaults are co-tenanted over disjoint table sets, exactly as the community
-- vault is. A co-tenant cannot read another's tables; a service reaching a table it
-- does not own goes over the network.

-- ===========================================================================
-- Cluster roles
-- ===========================================================================

CREATE ROLE clinical_vault_service NOLOGIN;
CREATE ROLE consent_service        NOLOGIN;
CREATE ROLE safety_crisis_service  NOLOGIN;
CREATE ROLE billing_subsidy_service NOLOGIN;
CREATE ROLE partner_service        NOLOGIN;

-- ===========================================================================
-- clinical-vault — three co-tenants
-- ===========================================================================
\connect clinical_vault

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public
    TO clinical_vault_service, consent_service, safety_crisis_service;

-- clinical-vault-service: the content, and the policy that governs each record.
GRANT SELECT, INSERT, UPDATE ON
    journal_entries, short_stories, mood_checkins, attachment_metadata,
    clinical_record_access_policies
    TO clinical_vault_service;
-- Reads consent to decide whether a decrypt is permitted. Cannot grant it.
GRANT SELECT ON consent_records, consent_versions, retention_preferences
    TO clinical_vault_service;

-- consent-service: owns consent. Cannot read a single word of what it governs.
GRANT SELECT, INSERT, UPDATE ON
    consent_versions, consent_records, consent_withdrawals, retention_preferences
    TO consent_service;
-- May flip a record's policy when consent changes, and may see that a record
-- exists — but has no grant on the ciphertext columns' tables beyond this one.
GRANT SELECT, UPDATE ON clinical_record_access_policies TO consent_service;

-- safety-crisis-service: signals and assessments. No access to content at all.
GRANT SELECT, INSERT, UPDATE ON safety_signals, risk_assessments
    TO safety_crisis_service;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
    TO clinical_vault_service, consent_service, safety_crisis_service;

-- Explicitly withheld, each because it was tempting:
--   consent_service        has no read on journal_entries or short_stories
--                          — the service that decides who may read something must not
--                            itself be able to read it
--   safety_crisis_service  has no read on journals, stories or mood
--                          — a crisis signal carries features, never content, and
--                            this is where that guarantee actually lives
--   clinical_vault_service has no write on consent_records
--                          — it cannot grant itself permission to decrypt
--   nobody                 has DELETE. Erasure runs through the retention workflow.

-- ===========================================================================
-- billing-vault
-- ===========================================================================
\connect billing_vault

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO billing_subsidy_service, partner_service;

GRANT SELECT, INSERT, UPDATE ON
    plans, subscriptions, payments, invoices,
    partner_funds, subsidy_programs, subsidy_allocations
    TO billing_subsidy_service;

-- partner-service: a partner sees their own fund and its utilisation. It must never
-- see WHO benefited, so it has no grant on subsidy_allocations — the only table here
-- carrying a pseudo_id that could be correlated with a beneficiary.
GRANT SELECT ON partner_funds, subsidy_programs TO partner_service;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
    TO billing_subsidy_service, partner_service;

-- Explicitly withheld:
--   partner_service  has no read on subsidy_allocations, payments or subscriptions
--                    — the de-identification promised in the partner dashboard is
--                      enforced by this grant, not by a query the dashboard happens
--                      to write today
--   partner_service  has no write anywhere
