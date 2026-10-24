-- core / 0002_retention
--
-- Export and deletion requests, and the record of what each one actually did.
--
-- Owning service: retention-service, which holds credentials to THESE TABLES ONLY.
-- It has no grant on any vault. Deletion happens through each owning service's purge
-- endpoint, because the service that owns a vault is the one that knows its foreign
-- keys, its legal holds and its encryption — and because a single role with DELETE on
-- every vault would be the most dangerous credential in the system.
--
-- Reasoning: metadata/access-control/vault-access-matrix/vault-access.v1.yaml
--            docs/backend/m9-retention.md

BEGIN;

-- ---------------------------------------------------------------------------
-- Deletion requests
-- ---------------------------------------------------------------------------

CREATE TABLE data_deletion_requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The join key. Deliberately NOT a foreign key to auth_accounts: the account row
    -- is one of the things this request destroys, and a constraint pointing at it
    -- would either block the deletion or cascade away the evidence of it.
    pseudo_id       bigint      NOT NULL,

    state           text        NOT NULL DEFAULT 'pending'
                    CHECK (state IN ('pending','in_progress','completed','partial','failed')),

    -- `partial` is a real outcome, not a failure. A post under legal hold survives a
    -- deletion; everything else still goes, and the member is told which records
    -- remain and why. Reporting that as `completed` would be a lie the audit trail
    -- would eventually expose.
    requested_at    timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz,

    -- Free text, shown to the member. Names the vaults that could not be cleared.
    detail          text,

    UNIQUE (pseudo_id, requested_at)
);

CREATE INDEX data_deletion_requests_open
    ON data_deletion_requests (state)
    WHERE state IN ('pending','in_progress');

-- ---------------------------------------------------------------------------
-- The outbox
-- ---------------------------------------------------------------------------
--
-- One row per vault per request. This is what makes a deletion survive a crash: the
-- work item is a database row in the same transaction that accepted the request, so a
-- service that dies halfway resumes rather than forgetting. A queue in Redis would
-- lose the request on the restart that this platform has already seen happen.

CREATE TABLE retention_jobs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      uuid        NOT NULL REFERENCES data_deletion_requests(id) ON DELETE CASCADE,
    pseudo_id       bigint      NOT NULL,

    -- Which service is asked to purge, by id from the service registry.
    target_service  text        NOT NULL,

    state           text        NOT NULL DEFAULT 'pending'
                    CHECK (state IN ('pending','running','done','held','failed')),

    -- `held` means the service refused for a reason the member is entitled to know:
    -- a record under legal hold. It is terminal and does not retry.
    attempts        smallint    NOT NULL DEFAULT 0,
    last_error      text,
    -- What the purge reported. A count, never a copy of what was removed.
    purged_count    integer,

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    UNIQUE (request_id, target_service)
);

CREATE INDEX retention_jobs_claimable
    ON retention_jobs (state, created_at)
    WHERE state IN ('pending','running');

-- ---------------------------------------------------------------------------
-- Export requests
-- ---------------------------------------------------------------------------

CREATE TABLE export_requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pseudo_id       bigint      NOT NULL,
    state           text        NOT NULL DEFAULT 'pending'
                    CHECK (state IN ('pending','delivered','failed')),
    requested_at    timestamptz NOT NULL DEFAULT now(),
    delivered_at    timestamptz,

    -- How much left the platform, so an unusual export is visible as one. The bytes
    -- themselves are never stored: an export is assembled, handed over, and forgotten.
    -- Keeping a copy would mean the act of asking for your data created a second one.
    byte_count      integer
);

CREATE INDEX export_requests_by_member ON export_requests (pseudo_id, requested_at DESC);

-- ---------------------------------------------------------------------------
-- Deletion evidence
-- ---------------------------------------------------------------------------
--
-- Separate from the audit vault and serving a different purpose. The audit vault
-- records that an access happened, hash-chained, on its own instance. This is the
-- receipt: which vault, what the service reported, when. It is what the member is
-- shown, and it must outlive everything it describes.

CREATE TABLE deletion_audit_logs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      uuid        NOT NULL REFERENCES data_deletion_requests(id) ON DELETE RESTRICT,

    -- RESTRICT, not CASCADE. Evidence of a deletion that can be removed by deleting
    -- the request is not evidence. Nothing in the application deletes a request row.
    pseudo_id       bigint      NOT NULL,
    target_service  text        NOT NULL,
    outcome         text        NOT NULL CHECK (outcome IN ('purged','held','failed')),
    purged_count    integer,
    detail          text,
    recorded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX deletion_audit_logs_by_request ON deletion_audit_logs (request_id);

COMMIT;
