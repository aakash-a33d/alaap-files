-- DELETE on the clinical vault, for erasure.
--
-- SUPERSEDES A CLAIM IN 0004_roles.clinical-billing.sql
--
-- That file ends with: "nobody has DELETE. Erasure runs through the retention
-- workflow." The first sentence was true and the second turned out not to follow from
-- it. retention-service holds no credential on this vault either — it cannot CONNECT —
-- so as the grants stood, no role on the platform could erase a journal entry. A
-- right to erasure that nothing can execute is not a right.
--
-- The line cannot be edited in place: the migration ledger checksums applied files, so
-- a privilege change is always a new one. This is that change, and this comment is the
-- correction.
--
-- WHAT ACTUALLY PROTECTS THESE ROWS
--
-- Not the absence of a grant. The member-facing delete is a soft delete — it sets
-- `deleted_at` and leaves the row — and remains so. The only code path that issues a
-- hard DELETE is `/internal/purge`, which:
--
--   * has no gateway route, and never will, so no member can call it for anybody
--   * is reachable only with a valid service-auth signature
--   * is driven by retention-service, which cannot open this database at all
--   * runs only behind a step-up the gateway demanded within the last fifteen minutes
--
-- Four independent conditions, none of which is a database grant. Withholding DELETE
-- was standing in for them, and it cost the platform the ability to keep its promise.
--
-- Matrix: metadata/access-control/vault-access-matrix/vault-access.v1.yaml
-- Spec:   docs/backend/m9-retention.md

\connect clinical_vault

-- clinical-vault-service: the content it owns, and only on purge.
GRANT DELETE ON
    journal_entries, short_stories, mood_checkins, attachment_metadata,
    clinical_record_access_policies
    TO clinical_vault_service;

-- consent-service: the consent records it owns. Still no read on a journal, so it can
-- erase the permission without ever seeing what the permission governed.
GRANT DELETE ON
    consent_records, consent_withdrawals, retention_preferences
    TO consent_service;

-- Deliberately NOT granted:
--   clinical_vault_service  has no DELETE on consent_records
--                           — it cannot erase the record of what it was permitted
--   consent_service         has no DELETE on journal_entries
--                           — and no SELECT either; the service that decides who may
--                             read something still cannot read or destroy it
--   retention_service       has no grant here at all, and cannot CONNECT
