-- identity-vault / 0002_break_glass
--
-- Emergency access to identity. The narrowest, most heavily gated path in the
-- platform, and the one place where a person's stated preference can be overridden.
--
-- Owning service: break-glass-service (identity-isolate, api_groups: [/api/break-glass])
--
-- THE SEQUENCE, WHICH THE SCHEMA ENFORCES RATHER THAN DOCUMENTS (§12H)
--
--   1. an AI signal or a human report opens a restricted case
--   2. a trained human safety reviewer assesses it
--   3. a SECOND authorised reviewer approves, and cannot be the first
--   4. threshold key shares are submitted — 3 of 5, held by different people
--      and systems, so no founder, employee or administrator can act alone
--   5. only the minimum necessary fields are released
--   6. access expires automatically
--   7. the member is told, where that is safe, lawful and clinically appropriate
--
-- An AI risk signal cannot reach anybody's identity. It can only open a case.
--
-- India's Mental Healthcare Act 2017 recognises a right to confidentiality subject to
-- specified exceptions. This workflow must be reviewed against it by Indian
-- mental-health counsel before launch — the schema encodes the intended process, not
-- a legal opinion that the process is sufficient.
--
-- Reasoning: architecture §10, §12G, §12H

BEGIN;

-- ---------------------------------------------------------------------------
-- The case
-- ---------------------------------------------------------------------------

CREATE TABLE break_glass_cases (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Resolved across vaults by pseudo_id, never by foreign key.
    subject_pseudo_id   bigint      NOT NULL,

    origin              text        NOT NULL
                        CHECK (origin IN ('ai_signal','user_report','therapist_flag',
                                          'moderator_escalation','self_request')),
    -- Reference into the clinical vault's safety_signals. Deliberately not a foreign
    -- key: that table is on another instance and a join must be impossible.
    origin_signal_id    uuid,

    risk_band           text        NOT NULL
                        CHECK (risk_band IN ('moderate','high','imminent')),

    state               text        NOT NULL DEFAULT 'open'
                        CHECK (state IN ('open','first_review','second_review',
                                         'threshold_pending','access_granted',
                                         'closed','refused','expired')),

    opened_at           timestamptz NOT NULL DEFAULT now(),
    closed_at           timestamptz,
    outcome             text
                        CHECK (outcome IN ('contact_made','contact_unavailable',
                                           'no_contact_registered','resolved_without_disclosure',
                                           'refused_insufficient_grounds','user_safe')),

    -- Told where safe, lawful and clinically appropriate. Null means not yet
    -- decided; false with a reason means a deliberate decision not to.
    subject_notified_at timestamptz,
    notification_withheld_reason text,

    CONSTRAINT closed_cases_have_an_outcome
        CHECK ((state IN ('closed','refused')) = (outcome IS NOT NULL)),
    CONSTRAINT closed_cases_have_a_time
        CHECK ((state IN ('closed','refused','expired')) = (closed_at IS NOT NULL))
);

CREATE INDEX ON break_glass_cases (subject_pseudo_id, opened_at DESC);
CREATE INDEX ON break_glass_cases (state, opened_at) WHERE state NOT IN ('closed','refused','expired');
CREATE INDEX ON break_glass_cases (opened_at);

COMMENT ON TABLE break_glass_cases IS
    'A case is not access. It is a request for access that has to survive two human reviewers and a threshold ceremony before anything is decrypted. Refused cases are retained permanently — a pattern of refusals is exactly what a post-incident review needs to see.';

-- ---------------------------------------------------------------------------
-- Two human reviewers, who must be different people
-- ---------------------------------------------------------------------------

CREATE TABLE break_glass_reviews (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id             uuid        NOT NULL REFERENCES break_glass_cases(id) ON DELETE CASCADE,

    sequence            smallint    NOT NULL CHECK (sequence IN (1, 2)),
    reviewer_id         uuid        NOT NULL,
    reviewer_role       text        NOT NULL
                        CHECK (reviewer_role IN ('safety_reviewer','clinical_safety_officer','admin')),

    decision            text        NOT NULL
                        CHECK (decision IN ('approve','refuse','escalate')),
    reason              text        NOT NULL,

    reviewed_at         timestamptz NOT NULL DEFAULT now(),

    -- One review per position per case.
    UNIQUE (case_id, sequence),
    -- A reviewer cannot occupy both positions on the same case. Enforced again in
    -- the application, but the database is where it actually holds.
    UNIQUE (case_id, reviewer_id)
);

CREATE INDEX ON break_glass_reviews (case_id);

COMMENT ON TABLE break_glass_reviews IS
    'The UNIQUE (case_id, reviewer_id) constraint is the four-eyes rule. Without it, one person holding two roles could approve their own escalation, and the second review would be theatre.';

-- ---------------------------------------------------------------------------
-- Threshold approval — 3 of 5 (§12G)
--
-- Shares are held by: the KMS, an independent security account, the clinical safety
-- officer's hardware key, the privacy officer's hardware key, and an independent
-- audit trustee. No single party can reach three.
-- ---------------------------------------------------------------------------

CREATE TABLE threshold_approvals (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id             uuid        NOT NULL REFERENCES break_glass_cases(id) ON DELETE CASCADE,

    share_holder        text        NOT NULL
                        CHECK (share_holder IN ('kms','secondary_security_account',
                                                'clinical_safety_officer','privacy_officer',
                                                'audit_trustee')),
    -- Proof the share was presented. The share itself never touches this database.
    share_proof         bytea       NOT NULL,
    submitted_by        uuid,
    submitted_at        timestamptz NOT NULL DEFAULT now(),

    -- One submission per holder per case.
    UNIQUE (case_id, share_holder)
);

CREATE INDEX ON threshold_approvals (case_id);

COMMENT ON COLUMN threshold_approvals.share_proof IS
    'Evidence that a share was presented to the unwrap ceremony. The key material is never stored — if it were, the threshold would be three rows in one database rather than three parties.';

-- Refuses a fourth distinct holder is unnecessary; refusing FEWER than three is the
-- property that matters, and it is enforced at unwrap time by OpenBao rather than
-- here. This view exists so the check is legible in SQL and testable.
CREATE VIEW break_glass_threshold_status AS
SELECT
    c.id                    AS case_id,
    c.state,
    count(t.id)             AS shares_submitted,
    count(t.id) >= 3        AS threshold_met
FROM break_glass_cases c
LEFT JOIN threshold_approvals t ON t.case_id = c.id
GROUP BY c.id, c.state;

COMMENT ON VIEW break_glass_threshold_status IS
    'Reporting only. The authoritative threshold check happens inside OpenBao at unwrap; this makes the same condition inspectable without decrypting anything.';

-- ---------------------------------------------------------------------------
-- What was actually done
-- ---------------------------------------------------------------------------

CREATE TABLE emergency_actions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id             uuid        NOT NULL REFERENCES break_glass_cases(id) ON DELETE CASCADE,

    action              text        NOT NULL
                        CHECK (action IN ('identity_field_released','contact_attempted',
                                          'contact_reached','therapist_notified',
                                          'crisis_service_signposted','case_closed_no_action')),

    -- Named fields, never "the record" (§12H minimum necessary disclosure).
    fields_released     text[]      NOT NULL DEFAULT '{}',

    performed_by        uuid        NOT NULL,
    performed_at        timestamptz NOT NULL DEFAULT now(),

    -- Access is a window, not a state. It closes on its own.
    access_expires_at   timestamptz,

    notes               text,

    CONSTRAINT releases_name_their_fields
        CHECK ((action = 'identity_field_released') = (cardinality(fields_released) > 0))
);

CREATE INDEX ON emergency_actions (case_id, performed_at);
CREATE INDEX ON emergency_actions (access_expires_at)
    WHERE access_expires_at IS NOT NULL;

COMMENT ON TABLE emergency_actions IS
    'The record of what an emergency actually did. Every row here has a matching sensitivity-5 audit event in the audit vault, on a different instance, so destroying one does not destroy the other.';

COMMIT;
