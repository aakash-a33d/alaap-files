-- identity-vault / 0001_identity
--
-- Real identity. The records whose disclosure is unrecoverable: legal names, verified
-- mobile numbers, emergency contacts, subsidy eligibility documents.
--
-- Alone on its own PostgreSQL instance and its own network segment, for CONTAINMENT
-- rather than scale (backend-requirements §1). A memory-disclosure bug in community
-- code must not be able to reach these rows.
--
-- Owning services: identity-vault-service, break-glass-service (both identity-isolate)
-- Reachable from the frontend: NEVER. Both declare api_groups: [] in the service
-- registry, and the gateway refuses at boot to route to a service that does.
--
-- What must never appear here: community posts, journals, mood logs, moderation
-- history, therapy content. This vault knows that a real person exists. It does not
-- know a single thing they have said.
--
-- ENVELOPE ENCRYPTION (§12F)
--
-- Sensitive fields are not stored as columns. The whole sensitive payload of a row is
-- encrypted with a data encryption key unique to that row; the DEK is itself wrapped
-- by a domain key that never leaves OpenBao. A row therefore carries ciphertext, a
-- wrapped DEK, and the key identity needed to unwrap it — and a database dump without
-- OpenBao yields nothing.
--
-- Cleartext columns exist only where the database itself must match, order or join on
-- the value. Everything else lives inside the ciphertext.
--
-- Reasoning: docs/backend/backend-requirements.md §1, §6, §11

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Identity tiers (§11)
--
-- Identity is collected at the point a specific obligation requires it, never "in
-- case it is needed later". Tier 0 holds a verified phone and an age band; a
-- government ID appears only at tier 4, and only where a funder requires it.
-- ---------------------------------------------------------------------------

CREATE TABLE identity_tiers (
    tier            smallint PRIMARY KEY CHECK (tier BETWEEN 0 AND 4),
    label           text     NOT NULL,
    trigger_event   text     NOT NULL,
    collects        text[]   NOT NULL
);

INSERT INTO identity_tiers (tier, label, trigger_event, collects) VALUES
    (0, 'Anonymous Community', 'registration',
        ARRAY['verified_mobile','age_band']),
    (1, 'Interaction Plus', 'paid plan',
        ARRAY['payment_token_reference']),
    (2, 'Care — psychologist', 'care booking',
        ARRAY['first_name','emergency_contact_optional']),
    (3, 'Care — psychiatrist', 'medical consultation',
        ARRAY['verified_identity_per_telemedicine_guidelines']),
    (4, 'Subsidy', 'subsidy claim',
        ARRAY['eligibility_documents','government_id_where_funder_requires']);

COMMENT ON TABLE identity_tiers IS
    'Tier 3 exists because identity obligations attach to the PRACTITIONER TYPE, not the plan. A psychiatrist is a Registered Medical Practitioner and must verify patient identity; a counsellor or clinical psychologist is not, and the same requirement does not attach.';

-- ---------------------------------------------------------------------------
-- The identity record
-- ---------------------------------------------------------------------------

CREATE TABLE identity_vault_records (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The only link to anything else on the platform. Vaults are never joined by
    -- foreign key; the application resolves across them by this value, under a
    -- consent check. There is deliberately no auth_accounts reference here — that
    -- table is on a different instance and must stay unreachable from this one.
    pseudo_id           bigint      NOT NULL UNIQUE,

    -- Envelope-encrypted payload: legal name, verified E.164 number, date of birth
    -- where required, address only where operationally necessary.
    payload_ciphertext  bytea       NOT NULL,
    payload_dek         bytea       NOT NULL,
    key_id              text        NOT NULL,
    key_version         integer     NOT NULL CHECK (key_version > 0),

    -- Blind index over the verified number: HMAC(pepper, e164), pepper in OpenBao.
    -- Answers "does a record exist for this number" without a decryptable column,
    -- and matches the value core.auth_accounts holds so the two can be reconciled
    -- without either instance learning the number.
    mobile_lookup_hash  bytea       NOT NULL UNIQUE,

    identity_tier       smallint    NOT NULL DEFAULT 0
                        REFERENCES identity_tiers(tier),

    -- Age BAND, not date of birth, wherever the exact date is not required. DPDP §9
    -- attaches to whether the person is a minor, which a band answers.
    age_band            text        CHECK (age_band IN ('under_18','18_24','25_34','35_49','50_plus')),

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    -- Set when the account closes. The row survives briefly for legal retention,
    -- then the retention worker purges it.
    erasure_due_at      timestamptz
);

CREATE INDEX ON identity_vault_records (identity_tier);
CREATE INDEX ON identity_vault_records (erasure_due_at) WHERE erasure_due_at IS NOT NULL;

COMMENT ON TABLE identity_vault_records IS
    'One row per real person. Holds no content of any kind — this vault knows that someone exists, never anything they have said.';
COMMENT ON COLUMN identity_vault_records.payload_dek IS
    'Data encryption key for this row, wrapped by the identity domain key in OpenBao. Useless without it.';

-- ---------------------------------------------------------------------------
-- Emergency contacts
--
-- A third party's personal data, held on someone else's account. They are told, they
-- confirm independently, and they can withdraw at any time without asking the member
-- (§3.3). Until they confirm, the contact is unusable.
-- ---------------------------------------------------------------------------

CREATE TABLE emergency_contacts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_record_id  uuid        NOT NULL REFERENCES identity_vault_records(id) ON DELETE CASCADE,

    -- Name and number of the contact, envelope-encrypted like everything else here.
    payload_ciphertext  bytea       NOT NULL,
    payload_dek         bytea       NOT NULL,
    key_id              text        NOT NULL,
    key_version         integer     NOT NULL CHECK (key_version > 0),

    relationship        text,

    state               text        NOT NULL DEFAULT 'pending'
                        CHECK (state IN ('pending','verified','declined','withdrawn','expired')),

    -- Single-use, hashed, short-lived. Sent to the contact, never to the member.
    verification_token_hash bytea,
    verification_sent_at    timestamptz,
    verification_expires_at timestamptz,
    verified_at             timestamptz,
    withdrawn_at            timestamptz,

    created_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT verified_contacts_have_a_time
        CHECK ((state = 'verified') = (verified_at IS NOT NULL)),
    CONSTRAINT withdrawn_contacts_have_a_time
        CHECK ((state = 'withdrawn') = (withdrawn_at IS NOT NULL))
);

-- At most one usable contact per person at a time. A partial unique index rather
-- than a plain one, so declined and withdrawn history is retained.
CREATE UNIQUE INDEX ON emergency_contacts (identity_record_id)
    WHERE state = 'verified';
CREATE INDEX ON emergency_contacts (verification_expires_at)
    WHERE state = 'pending';

COMMENT ON TABLE emergency_contacts IS
    'Only a verified contact may ever be disclosed, and only through an approved break-glass case. A member who declines to name one can be reached solely through their own number — the safety runbook must state what a high-risk case does then, rather than assuming a contact exists.';

-- ---------------------------------------------------------------------------
-- Care verification and subsidy eligibility
-- ---------------------------------------------------------------------------

CREATE TABLE care_verification_records (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_record_id  uuid        NOT NULL REFERENCES identity_vault_records(id) ON DELETE CASCADE,

    tier_requested      smallint    NOT NULL REFERENCES identity_tiers(tier),
    reason              text        NOT NULL
                        CHECK (reason IN ('group_care','one_to_one_psychologist',
                                          'psychiatrist','subsidy_claim')),

    state               text        NOT NULL DEFAULT 'pending'
                        CHECK (state IN ('pending','approved','rejected','expired')),

    -- Documents live in encrypted object storage. This is the reference and the
    -- integrity check, never the bytes.
    document_object_key text,
    document_sha256     bytea,
    document_kind       text
                        CHECK (document_kind IN ('government_id','student_id','income_proof',
                                                 'ngo_referral','employer_letter','other')),

    reviewed_by         uuid,
    reviewed_at         timestamptz,
    decision_reason     text,

    created_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz,

    CONSTRAINT reviewed_records_have_a_reviewer
        CHECK ((state IN ('approved','rejected')) = (reviewed_at IS NOT NULL))
);

CREATE INDEX ON care_verification_records (identity_record_id);
CREATE INDEX ON care_verification_records (state, created_at) WHERE state = 'pending';

COMMENT ON COLUMN care_verification_records.document_object_key IS
    'Object storage reference. A government ID is collected at tier 4 only, and is deleted once eligibility is decided — the decision is retained, the document is not.';

-- ---------------------------------------------------------------------------
-- Identity-level consent
--
-- Distinct from clinical consent, which lives in the clinical vault. This records
-- consent to hold identity at all, and to the specific processing each tier implies.
-- ---------------------------------------------------------------------------

CREATE TABLE identity_consent_records (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_record_id  uuid        NOT NULL REFERENCES identity_vault_records(id) ON DELETE CASCADE,

    purpose             text        NOT NULL,
    consent_version     text        NOT NULL,

    state               text        NOT NULL DEFAULT 'granted'
                        CHECK (state IN ('granted','withdrawn','expired','superseded')),

    granted_at          timestamptz NOT NULL DEFAULT now(),
    withdrawn_at        timestamptz,
    expires_at          timestamptz,

    -- Verifiable parental consent for under-18s (DPDP §9). Nullable because it does
    -- not apply to adults; the application refuses a minor record without it.
    guardian_verification_id uuid,

    CONSTRAINT withdrawn_consent_has_a_time
        CHECK ((state = 'withdrawn') = (withdrawn_at IS NOT NULL))
);

CREATE INDEX ON identity_consent_records (identity_record_id, purpose)
    WHERE state = 'granted';

COMMENT ON COLUMN identity_consent_records.guardian_verification_id IS
    'Age assurance is the sharpest open item in the model — a self-declared checkbox is unlikely to satisfy DPDP §9, and minimal identity collection pulls against verifiable assurance. This column exists so the obligation is visible in the schema; counsel must resolve the mechanism before launch.';

-- ---------------------------------------------------------------------------
-- Access requests and grants
--
-- Every read of an identity record is requested, reasoned and time-limited. There is
-- no ambient read: a service holding credentials still needs a live grant.
-- ---------------------------------------------------------------------------

CREATE TABLE identity_access_requests (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_record_id  uuid        NOT NULL REFERENCES identity_vault_records(id) ON DELETE CASCADE,

    requested_by        uuid        NOT NULL,
    requester_role      text        NOT NULL
                        CHECK (requester_role IN ('therapist','safety_reviewer','admin','service','system')),
    -- Must be a registered purpose. Checked again by the consent engine.
    purpose             text        NOT NULL,
    reason_code         text        NOT NULL,

    -- Set when the request arises from an emergency case. Break-glass is the only
    -- route to an emergency contact, and this is where that link is recorded.
    break_glass_case_id uuid,

    state               text        NOT NULL DEFAULT 'pending'
                        CHECK (state IN ('pending','granted','refused','expired')),

    requested_at        timestamptz NOT NULL DEFAULT now(),
    decided_at          timestamptz
);

CREATE INDEX ON identity_access_requests (identity_record_id, requested_at DESC);
CREATE INDEX ON identity_access_requests (state, requested_at) WHERE state = 'pending';

CREATE TABLE identity_access_grants (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id          uuid        NOT NULL REFERENCES identity_access_requests(id) ON DELETE CASCADE,

    -- Minimum necessary disclosure (§12H). Named fields, never "the record".
    fields_released     text[]      NOT NULL CHECK (cardinality(fields_released) > 0),

    granted_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    revoked_at          timestamptz,

    CONSTRAINT grants_expire
        CHECK (expires_at > granted_at)
);

CREATE INDEX ON identity_access_grants (expires_at) WHERE revoked_at IS NULL;

COMMENT ON COLUMN identity_access_grants.fields_released IS
    'Exactly which fields were disclosed. A grant is never "read the record" — it is a list, and the audit event records the same list.';

COMMIT;
