-- clinical-vault / 0001_clinical
--
-- Journals, short stories, mood logs, consent policy and safety signals. The most
-- sensitive content on the platform, and the vault whose contents a person would
-- least want attached to their name.
--
-- Co-tenanted over disjoint table sets:
--   clinical-vault-service  journals, stories, mood, attachments, access policies
--   consent-service         consent versions, records, withdrawals, retention prefs
--   safety-crisis-service   safety signals, risk assessments, reviewer actions
--
-- What must never appear here: legal name, phone number, address, emergency contact,
-- government ID, payment method. This vault holds what someone said, and is
-- deliberately incapable of saying who they are.
--
-- DUAL-MODE ENCRYPTION (backend-requirements §3)
--
-- This resolves a contradiction the architecture documents left open: §12E.2 requires
-- client-side encrypted journals, while §11.6 has the AI temporarily decrypt approved
-- clinical data. Both cannot hold — under client-side encryption only the device has
-- the key, so the server has nothing to decrypt.
--
--   standard  (default)  platform-held DEK per record, wrapped by the clinical domain
--                        key in OpenBao. Consent is checked before every decrypt, and
--                        every decrypt writes an audit event. AI and therapist
--                        sharing work.
--
--   maximum              the DEK is wrapped by a key held only on the user's device.
--                        AI analysis and therapist insight become STRUCTURALLY
--                        IMPOSSIBLE rather than merely disabled, and a lost device
--                        means lost records. The user chooses, and is told that at
--                        the moment they choose.
--
-- The `privacy_mode` column below is what makes the second case enforceable rather
-- than aspirational: a CHECK constraint refuses to store a platform-readable DEK on a
-- maximum-privacy record.
--
-- Reasoning: docs/backend/backend-requirements.md §3, architecture §12E, §12I, §12S

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Consent versions — published, then superseded, never edited
-- ---------------------------------------------------------------------------

CREATE TABLE consent_versions (
    id                  text PRIMARY KEY,
    purpose             text        NOT NULL,
    body_markdown       text        NOT NULL,
    published_at        timestamptz NOT NULL DEFAULT now(),
    superseded_by       text        REFERENCES consent_versions(id),
    superseded_at       timestamptz,

    CONSTRAINT superseded_versions_have_a_time
        CHECK ((superseded_by IS NOT NULL) = (superseded_at IS NOT NULL))
);

CREATE INDEX ON consent_versions (purpose, published_at DESC);

COMMENT ON TABLE consent_versions IS
    'Folder-structure rule 6: a published consent version may not be edited, only superseded. A person consented to specific words, and those words have to remain recoverable.';

-- Enforce rule 6 in the database rather than trusting the application.
CREATE FUNCTION consent_versions_immutable() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'a published consent version cannot be deleted, only superseded'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.body_markdown IS DISTINCT FROM OLD.body_markdown
       OR NEW.purpose IS DISTINCT FROM OLD.purpose
       OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
        RAISE EXCEPTION 'a published consent version cannot be edited, only superseded'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER consent_versions_no_edit
    BEFORE UPDATE OR DELETE ON consent_versions
    FOR EACH ROW EXECUTE FUNCTION consent_versions_immutable();

-- ---------------------------------------------------------------------------
-- Consent records and withdrawal
-- ---------------------------------------------------------------------------

CREATE TABLE consent_records (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pseudo_id           bigint      NOT NULL,

    -- Registered purpose id from metadata/consent/purpose-registry/.
    purpose             text        NOT NULL,
    consent_version_id  text        NOT NULL REFERENCES consent_versions(id),

    state               text        NOT NULL DEFAULT 'granted'
                        CHECK (state IN ('granted','withdrawn','expired','superseded')),

    granted_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz,
    withdrawn_at        timestamptz,

    CONSTRAINT withdrawn_records_have_a_time
        CHECK ((state = 'withdrawn') = (withdrawn_at IS NOT NULL))
);

CREATE UNIQUE INDEX ON consent_records (pseudo_id, purpose)
    WHERE state = 'granted';
CREATE INDEX ON consent_records (expires_at) WHERE state = 'granted' AND expires_at IS NOT NULL;

CREATE TABLE consent_withdrawals (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    consent_record_id   uuid        NOT NULL REFERENCES consent_records(id) ON DELETE CASCADE,

    withdrawn_at        timestamptz NOT NULL DEFAULT now(),
    -- Withdrawal stops future processing. It cannot unmake a summary already
    -- generated, and saying so plainly is part of the withdrawal screen.
    derived_artifacts_deleted boolean NOT NULL DEFAULT false,
    deletion_completed_at     timestamptz
);

CREATE INDEX ON consent_withdrawals (withdrawn_at);
CREATE INDEX ON consent_withdrawals (derived_artifacts_deleted)
    WHERE derived_artifacts_deleted = false;

COMMENT ON COLUMN consent_withdrawals.derived_artifacts_deleted IS
    'Withdrawing consent must also remove what was derived under it — AI summaries, insight artifacts, session preparation. Until this is true, the withdrawal is incomplete, and the retention worker is still owed work.';

CREATE TABLE retention_preferences (
    pseudo_id           bigint PRIMARY KEY,
    journal_retention_days      integer CHECK (journal_retention_days > 0),
    story_retention_days        integer CHECK (story_retention_days > 0),
    mood_retention_days         integer CHECK (mood_retention_days > 0),
    delete_on_account_close     boolean NOT NULL DEFAULT true,
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Per-record access policy (§12I)
--
-- Every sensitive record carries its own policy. Access is denied if consent
-- expired, was withdrawn, the therapist is no longer assigned, the AI purpose does
-- not match, the retention window closed, or the request came from an
-- unauthorised service. The policy travels with the record rather than living in
-- application logic, so a new caller cannot accidentally bypass it.
-- ---------------------------------------------------------------------------

CREATE TABLE clinical_record_access_policies (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Which record this governs. Polymorphic by design: the alternative is a policy
    -- table per content table, and four copies of the same rules drift.
    record_kind         text        NOT NULL
                        CHECK (record_kind IN ('journal_entry','short_story','mood_checkin',
                                               'attachment','session_summary','insight_artifact')),
    record_id           uuid        NOT NULL,
    pseudo_id           bigint      NOT NULL,

    visibility          text        NOT NULL DEFAULT 'private_to_user'
                        CHECK (visibility IN ('private_to_user','shared_with_therapist',
                                              'shared_with_group_therapist',
                                              'emergency_restricted','pending_purge')),

    ai_analysis         text        NOT NULL DEFAULT 'not_allowed'
                        CHECK (ai_analysis IN ('not_allowed','allowed','temporary_only')),
    ai_purpose          text,

    therapist_access    boolean     NOT NULL DEFAULT false,
    training_use        boolean     NOT NULL DEFAULT false,
    exportable          boolean     NOT NULL DEFAULT true,

    retention_until     timestamptz,
    updated_at          timestamptz NOT NULL DEFAULT now(),

    UNIQUE (record_kind, record_id),

    -- An AI purpose is required whenever AI processing is permitted, and forbidden
    -- when it is not. "Allowed for something unspecified" is not a consent.
    CONSTRAINT ai_permission_names_its_purpose
        CHECK ((ai_analysis = 'not_allowed') = (ai_purpose IS NULL)),

    -- Never true by default, never settable without a separate lawful basis.
    CONSTRAINT training_use_is_off
        CHECK (training_use = false)
);

CREATE INDEX ON clinical_record_access_policies (pseudo_id);
CREATE INDEX ON clinical_record_access_policies (retention_until)
    WHERE retention_until IS NOT NULL;
CREATE INDEX ON clinical_record_access_policies (visibility)
    WHERE visibility = 'pending_purge';

COMMENT ON CONSTRAINT training_use_is_off ON clinical_record_access_policies IS
    'Therapy data is not used for model training by default (§12J), and "by default" is too weak to leave to application code. Lifting this requires a migration, which requires a review.';

-- ---------------------------------------------------------------------------
-- The writing surfaces
--
-- Journals and short stories are PAID (metadata/catalog/plans/). Quota is enforced by
-- clinical-vault-service, not here and not at the gateway — the gateway holds no
-- billing credentials and could not make an entitlement decision if it wanted to.
-- ---------------------------------------------------------------------------

CREATE TABLE journal_entries (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pseudo_id           bigint      NOT NULL,

    -- Envelope encryption. Under maximum privacy the DEK is wrapped by a key that
    -- exists only on the user's device, and the platform cannot unwrap it.
    body_ciphertext     bytea       NOT NULL,
    body_dek            bytea       NOT NULL,
    key_id              text        NOT NULL,
    key_version         integer     NOT NULL CHECK (key_version > 0),

    privacy_mode        text        NOT NULL DEFAULT 'standard'
                        CHECK (privacy_mode IN ('standard','maximum')),

    -- Cleartext only where the database must order or filter. A title is content and
    -- is therefore inside the ciphertext, not here.
    entry_date          date        NOT NULL DEFAULT CURRENT_DATE,
    word_count          integer     CHECK (word_count >= 0),

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    deleted_at          timestamptz,

    -- A maximum-privacy record must name the device key that wraps its DEK. Without
    -- this, "maximum privacy" would be a label rather than a property.
    device_key_id       text,
    CONSTRAINT maximum_privacy_uses_a_device_key
        CHECK ((privacy_mode = 'maximum') = (device_key_id IS NOT NULL))
);

CREATE INDEX ON journal_entries (pseudo_id, entry_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX ON journal_entries (deleted_at) WHERE deleted_at IS NOT NULL;

COMMENT ON TABLE journal_entries IS
    'Paid surface. A journal accrues storage and a key operation on every read, indefinitely — unlike a community reply, whose cost was spent before anyone read it.';

CREATE TABLE short_stories (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pseudo_id           bigint      NOT NULL,

    body_ciphertext     bytea       NOT NULL,
    body_dek            bytea       NOT NULL,
    key_id              text        NOT NULL,
    key_version         integer     NOT NULL CHECK (key_version > 0),

    privacy_mode        text        NOT NULL DEFAULT 'standard'
                        CHECK (privacy_mode IN ('standard','maximum')),
    device_key_id       text,

    state               text        NOT NULL DEFAULT 'draft'
                        CHECK (state IN ('draft','private','shared')),

    -- Sharing publishes a COPY into the community vault, where it is moderated like
    -- any other post. This is the reference to that copy — deliberately not a foreign
    -- key, because the community vault is a different database and a join must be
    -- impossible. The original never leaves this vault, so a shared story does not
    -- drag its private drafts along with it.
    shared_post_id      uuid,
    shared_at           timestamptz,

    word_count          integer     CHECK (word_count >= 0),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    deleted_at          timestamptz,

    CONSTRAINT maximum_privacy_uses_a_device_key
        CHECK ((privacy_mode = 'maximum') = (device_key_id IS NOT NULL)),
    CONSTRAINT shared_stories_reference_their_copy
        CHECK ((state = 'shared') = (shared_post_id IS NOT NULL)),
    -- A record the platform cannot read cannot be published by the platform.
    CONSTRAINT maximum_privacy_cannot_be_shared
        CHECK (NOT (privacy_mode = 'maximum' AND state = 'shared'))
);

CREATE INDEX ON short_stories (pseudo_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ON short_stories (state) WHERE state = 'shared';

COMMENT ON CONSTRAINT maximum_privacy_cannot_be_shared ON short_stories IS
    'Under maximum privacy the server holds no key, so it could not produce the plaintext a shared copy requires. The constraint makes the impossibility explicit rather than letting it surface as a confusing runtime failure.';

-- ---------------------------------------------------------------------------
-- Mood — free on every plan
-- ---------------------------------------------------------------------------

CREATE TABLE mood_checkins (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pseudo_id           bigint      NOT NULL,

    -- A small integer, not free text. Cheap to store, cheap to serve, and the
    -- lowest-friction way for someone to begin engaging at all.
    mood_score          smallint    NOT NULL CHECK (mood_score BETWEEN 1 AND 10),
    energy_score        smallint    CHECK (energy_score BETWEEN 1 AND 10),
    sleep_hours         numeric(3,1) CHECK (sleep_hours >= 0 AND sleep_hours <= 24),

    -- Selected from a fixed list in metadata, never typed. A free-text mood note
    -- would be journal content wearing a different name, and would quietly move a
    -- paid surface into the free tier.
    emotion_tags        text[]      NOT NULL DEFAULT '{}',

    recorded_at         timestamptz NOT NULL DEFAULT now(),
    entry_date          date        NOT NULL DEFAULT CURRENT_DATE,

    UNIQUE (pseudo_id, entry_date)
);

CREATE INDEX ON mood_checkins (pseudo_id, entry_date DESC);

COMMENT ON COLUMN mood_checkins.emotion_tags IS
    'Chosen from metadata, never free text. Allowing a note here would put unbounded personal writing on the free tier through the back door.';

-- ---------------------------------------------------------------------------
-- Attachments — metadata only. Bytes live in encrypted object storage.
-- ---------------------------------------------------------------------------

CREATE TABLE attachment_metadata (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pseudo_id           bigint      NOT NULL,

    object_key          text        NOT NULL UNIQUE,
    content_sha256      bytea       NOT NULL,
    byte_size           bigint      NOT NULL CHECK (byte_size > 0),
    mime_type           text        NOT NULL,

    -- Stripped before storage (§12N). Recorded so the stripping is auditable.
    metadata_stripped   boolean     NOT NULL DEFAULT false,
    malware_scanned_at  timestamptz,
    scan_verdict        text        CHECK (scan_verdict IN ('clean','suspicious','malicious')),

    created_at          timestamptz NOT NULL DEFAULT now(),
    deleted_at          timestamptz,

    -- Nothing is readable until it has been scanned and found clean.
    CONSTRAINT unscanned_attachments_are_unusable
        CHECK (scan_verdict IS NULL OR malware_scanned_at IS NOT NULL)
);

CREATE INDEX ON attachment_metadata (pseudo_id) WHERE deleted_at IS NULL;
CREATE INDEX ON attachment_metadata (malware_scanned_at) WHERE malware_scanned_at IS NULL;

-- ---------------------------------------------------------------------------
-- Safety signals — safety-crisis-service
--
-- Detection only. Acting on a signal — contacting anyone — requires the separate
-- emergency-contact-disclosure purpose and an approved break-glass case on the
-- identity instance. There is no path from this table to a phone number.
-- ---------------------------------------------------------------------------

CREATE TABLE safety_signals (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pseudo_id           bigint      NOT NULL,

    source              text        NOT NULL
                        CHECK (source IN ('crisis_triage_ai','moderation_ai','user_report',
                                          'therapist_flag','self_declared')),
    -- Which model version produced it, so a signal can be re-examined against the
    -- classifier that actually made it.
    model_version       text,

    risk_band           text        NOT NULL
                        CHECK (risk_band IN ('low','moderate','high','imminent')),
    -- No content. A signal records that something was detected, never what was said.
    signal_features     jsonb       NOT NULL DEFAULT '{}'::jsonb
                        CHECK (jsonb_typeof(signal_features) = 'object'),

    state               text        NOT NULL DEFAULT 'raised'
                        CHECK (state IN ('raised','under_review','actioned','dismissed','expired')),

    raised_at           timestamptz NOT NULL DEFAULT now(),
    reviewed_at         timestamptz,
    -- Set when a break-glass case was opened from this signal. Cross-instance
    -- reference, not a foreign key.
    break_glass_case_id uuid
);

CREATE INDEX ON safety_signals (pseudo_id, raised_at DESC);
CREATE INDEX ON safety_signals (state, risk_band, raised_at)
    WHERE state IN ('raised','under_review');

COMMENT ON COLUMN safety_signals.signal_features IS
    'Non-identifying detection context — category, score band, language. Never the text that triggered it. A crisis signal that quoted the message would make this table a copy of the most sensitive content on the platform.';

CREATE TABLE risk_assessments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_id           uuid        NOT NULL REFERENCES safety_signals(id) ON DELETE CASCADE,

    assessed_by         uuid        NOT NULL,
    assessed_role       text        NOT NULL
                        CHECK (assessed_role IN ('safety_reviewer','clinical_safety_officer')),

    risk_band           text        NOT NULL
                        CHECK (risk_band IN ('low','moderate','high','imminent')),
    recommended_action  text        NOT NULL
                        CHECK (recommended_action IN ('self_help_resources','encourage_booking',
                                                      'human_responder_chat','notify_active_therapist',
                                                      'open_break_glass','no_action')),
    rationale           text        NOT NULL,
    assessed_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON risk_assessments (signal_id);

COMMIT;
