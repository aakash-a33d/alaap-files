-- core / 0001_auth
--
-- Authentication state. Credentials and sessions only — never personal data content.
-- The real person behind an account lives in the identity vault; the public persona
-- lives in the community vault. This database knows neither.
--
-- Owning service: auth-service (sole holder of credentials to this database)
-- Reasoning:      docs/backend/backend-requirements.md §5

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

CREATE TABLE auth_accounts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The join key to every other vault. Vaults are never joined by foreign key;
    -- the application resolves across them by this value, under a consent check.
    pseudo_id           bigint      NOT NULL UNIQUE,

    -- Blind index over the verified mobile number: HMAC(pepper, e164). Allows
    -- "does an account exist for this number" without storing the number here.
    -- The number itself lives only in the identity vault.
    mobile_lookup_hash  bytea       NOT NULL UNIQUE,

    status              text        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','suspended','locked','closed')),
    preferred_language  text        NOT NULL DEFAULT 'en',
    age_confirmed       boolean     NOT NULL DEFAULT false,

    -- Country only, and only to route the correct crisis helpline. Region was
    -- dropped: nothing in the product needs it, and minimisation means not
    -- collecting a field on the chance it becomes useful later.
    country             text,

    -- Maximum Privacy Mode (§12S). Journals written while this is on are stored
    -- ciphertext-only and are unreadable by the platform.
    privacy_mode        text        NOT NULL DEFAULT 'standard'
                        CHECK (privacy_mode IN ('standard','maximum')),

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    closed_at           timestamptz,

    CONSTRAINT closed_accounts_have_a_date
        CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

COMMENT ON COLUMN auth_accounts.mobile_lookup_hash IS
    'HMAC of the E.164 number under a pepper held in the KMS. Never reversible here.';

-- ---------------------------------------------------------------------------
-- Passkeys — the primary authentication method (§12M)
-- ---------------------------------------------------------------------------

CREATE TABLE passkey_credentials (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          uuid        NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,

    credential_id       bytea       NOT NULL UNIQUE,
    public_key          bytea       NOT NULL,
    sign_count          bigint      NOT NULL DEFAULT 0,
    transports          text[]      NOT NULL DEFAULT '{}',
    aaguid              uuid,

    -- Attested authenticators only for staff and therapists; users may self-attest.
    backup_eligible     boolean     NOT NULL DEFAULT false,
    backup_state        boolean     NOT NULL DEFAULT false,

    label               text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    last_used_at        timestamptz,
    revoked_at          timestamptz
);

CREATE INDEX ON passkey_credentials (account_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Recovery codes — single-use, stored hashed
-- ---------------------------------------------------------------------------

CREATE TABLE recovery_codes (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          uuid        NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
    code_hash           bytea       NOT NULL,
    bundle_generation   integer     NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    consumed_at         timestamptz
);

CREATE INDEX ON recovery_codes (account_id) WHERE consumed_at IS NULL;

COMMENT ON TABLE recovery_codes IS
    'Regenerating a bundle increments bundle_generation and invalidates prior codes. Recovery cannot restore Maximum Privacy Mode records — the key is not held here.';

-- ---------------------------------------------------------------------------
-- Devices and sessions
--
-- Live sessions are opaque tokens in Redis (§5); this table is the durable record
-- used for "log out everywhere", suspicious-login review and audit correlation.
-- ---------------------------------------------------------------------------

CREATE TABLE trusted_devices (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          uuid        NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
    device_hash         bytea       NOT NULL,
    label               text,
    first_seen_at       timestamptz NOT NULL DEFAULT now(),
    last_seen_at        timestamptz NOT NULL DEFAULT now(),
    revoked_at          timestamptz,
    UNIQUE (account_id, device_hash)
);

CREATE TABLE sessions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          uuid        NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
    device_id           uuid        REFERENCES trusted_devices(id) ON DELETE SET NULL,

    -- Opaque token, hashed. The token itself is never stored.
    token_hash          bytea       NOT NULL UNIQUE,

    actor_role          text        NOT NULL DEFAULT 'user'
                        CHECK (actor_role IN ('user','therapist','moderator','admin','safety_reviewer','partner')),

    -- Step-up assertions expire independently of, and sooner than, the session (§5).
    stepped_up_at       timestamptz,
    stepped_up_scope    text,

    created_at          timestamptz NOT NULL DEFAULT now(),
    last_active_at      timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    absolute_expires_at timestamptz NOT NULL,
    revoked_at          timestamptz,
    revoked_reason      text,

    CONSTRAINT sliding_window_within_absolute
        CHECK (expires_at <= absolute_expires_at)
);

CREATE INDEX ON sessions (account_id) WHERE revoked_at IS NULL;
CREATE INDEX ON sessions (absolute_expires_at) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Login events — security signal, not audit
--
-- The immutable audit trail lives in the audit vault. This table exists for
-- rate limiting and suspicious-login detection, and is retained on a short cycle.
-- ---------------------------------------------------------------------------

CREATE TABLE login_events (
    id                  bigserial PRIMARY KEY,
    account_id          uuid        REFERENCES auth_accounts(id) ON DELETE SET NULL,
    occurred_at         timestamptz NOT NULL DEFAULT now(),
    method              text        NOT NULL
                        CHECK (method IN ('passkey','otp','recovery_code')),
    result              text        NOT NULL
                        CHECK (result IN ('success','failure','locked_out','challenged')),

    -- Truncated to a /24 or /48 prefix before insert. Short retention (§12N).
    ip_prefix           inet,
    user_agent_hash     bytea,
    risk_score          smallint    CHECK (risk_score BETWEEN 0 AND 100)
);

CREATE INDEX ON login_events (account_id, occurred_at DESC);
CREATE INDEX ON login_events (occurred_at);

COMMIT;
