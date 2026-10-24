-- billing-vault / 0001_billing
--
-- Plans, subscriptions, payments, and the subsidy machinery that lets a partner fund
-- someone's care without ever learning who they are.
--
-- Owning service: billing-subsidy-service
--
-- What must never appear here: journals, therapy notes, community post content,
-- moderation history, legal names. This vault knows what someone pays for. It does
-- not know what they said, and it does not know their name.
--
-- NO CARD DATA, EVER. Razorpay holds the instrument; this vault stores a token
-- reference (§12B). RBI e-mandate rules govern the recurring debits for the ₹99 and
-- ₹799 plans, and card-on-file tokenisation applies — both are the gateway's
-- obligation to satisfy, and neither changes what is stored here.
--
-- Reasoning: docs/backend/backend-requirements.md §10, architecture §2.1

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Plans
--
-- Prices and quotas are declared in metadata/catalog/plans/plans.v1.yaml and seeded
-- here. The metadata file is the source of truth — this table is its projection, so
-- that a subscription can carry a foreign key to the plan it was sold under.
-- ---------------------------------------------------------------------------

CREATE TABLE plans (
    id                  text PRIMARY KEY,
    name                text        NOT NULL,
    tier                smallint    NOT NULL CHECK (tier BETWEEN 0 AND 3),

    -- Paise, not rupees. Storing money as an integer of the smallest unit avoids the
    -- rounding arguments that decimal currency columns eventually produce.
    standard_price_paise    integer CHECK (standard_price_paise >= 0),
    subsidised_price_paise  integer CHECK (subsidised_price_paise >= 0),
    provider_specific       boolean NOT NULL DEFAULT false,

    active              boolean     NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT provider_priced_plans_have_no_list_price
        CHECK (provider_specific = (standard_price_paise IS NULL)),
    CONSTRAINT subsidised_never_exceeds_standard
        CHECK (subsidised_price_paise IS NULL
               OR standard_price_paise IS NULL
               OR subsidised_price_paise <= standard_price_paise)
);

COMMENT ON TABLE plans IS
    'Projection of metadata/catalog/plans/. Quotas and entitlements are NOT duplicated here — they are read from metadata by the services that enforce them, and a second copy would drift.';

-- ---------------------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------------------

CREATE TABLE subscriptions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pseudo_id           bigint      NOT NULL,
    plan_id             text        NOT NULL REFERENCES plans(id),

    state               text        NOT NULL DEFAULT 'active'
                        CHECK (state IN ('trialing','active','past_due','paused','cancelled','expired')),

    -- Razorpay references. No card number, expiry or CVV reaches this database.
    gateway_customer_ref     text,
    gateway_subscription_ref text,
    -- RBI e-mandate: a recurring debit requires an explicit mandate and a pre-debit
    -- notification. Both are recorded so a disputed charge can be reconstructed.
    mandate_ref              text,
    mandate_granted_at       timestamptz,
    last_pre_debit_notice_at timestamptz,

    -- Set when a subsidy is meeting part of the price.
    subsidy_allocation_id    uuid,

    started_at          timestamptz NOT NULL DEFAULT now(),
    current_period_end  timestamptz,
    cancelled_at        timestamptz,

    CONSTRAINT cancelled_subscriptions_have_a_time
        CHECK ((state = 'cancelled') = (cancelled_at IS NOT NULL)),
    CONSTRAINT mandates_are_dated
        CHECK ((mandate_ref IS NULL) = (mandate_granted_at IS NULL))
);

CREATE UNIQUE INDEX ON subscriptions (pseudo_id)
    WHERE state IN ('trialing','active','past_due');
CREATE INDEX ON subscriptions (current_period_end) WHERE state = 'active';
CREATE INDEX ON subscriptions (plan_id);

-- ---------------------------------------------------------------------------
-- Subsidy: partner funds, programmes, allocations
--
-- The Care Access Fund. A partner deposits a corpus; eligible members draw from it at
-- the subsidised rate; when the corpus is exhausted, subsidised slots close. That
-- last property is what stops a therapist tier becoming an unbounded liability.
--
-- The partner never learns who benefited. They see fund balance, utilisation and
-- de-identified outcome counts — and the separation between those aggregates and the
-- allocations below is the whole point of this design.
-- ---------------------------------------------------------------------------

CREATE TABLE partner_funds (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_name        text        NOT NULL,
    partner_kind        text        NOT NULL
                        CHECK (partner_kind IN ('csr','ngo','university','employer',
                                                'government','platform')),

    deposited_paise     bigint      NOT NULL CHECK (deposited_paise >= 0),
    committed_paise     bigint      NOT NULL DEFAULT 0 CHECK (committed_paise >= 0),
    disbursed_paise     bigint      NOT NULL DEFAULT 0 CHECK (disbursed_paise >= 0),

    -- Shown in the interface beside the subsidised price, so a member always knows
    -- who is paying the difference. Never presented as a government subsidy unless
    -- it genuinely is one.
    display_label       text        NOT NULL,

    opened_at           timestamptz NOT NULL DEFAULT now(),
    closes_at           timestamptz,

    CONSTRAINT cannot_disburse_more_than_deposited
        CHECK (disbursed_paise <= deposited_paise),
    CONSTRAINT cannot_commit_more_than_deposited
        CHECK (committed_paise <= deposited_paise)
);

COMMENT ON CONSTRAINT cannot_disburse_more_than_deposited ON partner_funds IS
    'The corpus is the cap. When it is exhausted, subsidised slots close — which is the mechanism that protects the platform from promising more therapist capacity than exists or than anyone has paid for.';

CREATE TABLE subsidy_programs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fund_id             uuid        NOT NULL REFERENCES partner_funds(id) ON DELETE RESTRICT,
    plan_id             text        NOT NULL REFERENCES plans(id),

    -- What the fund contributes per member per period.
    contribution_paise  integer     NOT NULL CHECK (contribution_paise > 0),
    slots_total         integer     CHECK (slots_total > 0),
    slots_claimed       integer     NOT NULL DEFAULT 0 CHECK (slots_claimed >= 0),

    eligibility_rule    text        NOT NULL
                        CHECK (eligibility_rule IN ('student','income_based','ngo_referral',
                                                    'employer_roster','partner_code','manual_review')),
    approval_method     text        NOT NULL
                        CHECK (approval_method IN ('automatic','partner_code','manual_review','referral')),

    active              boolean     NOT NULL DEFAULT true,
    starts_at           timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz,

    CONSTRAINT slots_claimed_within_total
        CHECK (slots_total IS NULL OR slots_claimed <= slots_total)
);

CREATE INDEX ON subsidy_programs (fund_id);
CREATE INDEX ON subsidy_programs (plan_id, active) WHERE active = true;

CREATE TABLE subsidy_allocations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id          uuid        NOT NULL REFERENCES subsidy_programs(id) ON DELETE RESTRICT,
    pseudo_id           bigint      NOT NULL,

    contribution_paise  integer     NOT NULL CHECK (contribution_paise > 0),
    member_paise        integer     NOT NULL CHECK (member_paise >= 0),

    state               text        NOT NULL DEFAULT 'reserved'
                        CHECK (state IN ('reserved','claimed','released','expired')),

    reserved_at         timestamptz NOT NULL DEFAULT now(),
    claimed_at          timestamptz,
    released_at         timestamptz,
    expires_at          timestamptz
);

CREATE UNIQUE INDEX ON subsidy_allocations (program_id, pseudo_id)
    WHERE state IN ('reserved','claimed');
CREATE INDEX ON subsidy_allocations (expires_at) WHERE state = 'reserved';

COMMENT ON TABLE subsidy_allocations IS
    'Holds a pseudo_id, never a name — the partner funding the allocation cannot resolve it, because the identity vault is on another instance and partner-service has no access to either. That is the separation the partner reporting is evidence of.';

-- ---------------------------------------------------------------------------
-- Payments and invoices
-- ---------------------------------------------------------------------------

CREATE TABLE payments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id     uuid        REFERENCES subscriptions(id) ON DELETE SET NULL,
    pseudo_id           bigint      NOT NULL,

    amount_paise        integer     NOT NULL CHECK (amount_paise > 0),
    currency            text        NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),

    state               text        NOT NULL DEFAULT 'pending'
                        CHECK (state IN ('pending','authorised','captured','failed','refunded','disputed')),

    -- Gateway references only.
    gateway_payment_ref text        UNIQUE,
    gateway_order_ref   text,
    failure_code        text,

    -- Split settlement: what the member paid versus what a fund met.
    member_paise        integer     NOT NULL DEFAULT 0 CHECK (member_paise >= 0),
    subsidy_paise       integer     NOT NULL DEFAULT 0 CHECK (subsidy_paise >= 0),

    created_at          timestamptz NOT NULL DEFAULT now(),
    captured_at         timestamptz,

    CONSTRAINT split_sums_to_total
        CHECK (member_paise + subsidy_paise = amount_paise),
    CONSTRAINT captured_payments_have_a_time
        CHECK ((state = 'captured') = (captured_at IS NOT NULL))
);

CREATE INDEX ON payments (pseudo_id, created_at DESC);
CREATE INDEX ON payments (subscription_id);
CREATE INDEX ON payments (state, created_at) WHERE state IN ('pending','authorised');

COMMENT ON CONSTRAINT split_sums_to_total ON payments IS
    'The member half plus the subsidy half must equal the charge. Without this the subsidy dashboard and the payment ledger can disagree, and reconciling them afterwards means asking a partner to trust arithmetic nobody can reproduce.';

CREATE TABLE invoices (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id          uuid        NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    pseudo_id           bigint      NOT NULL,

    invoice_number      text        NOT NULL UNIQUE,
    -- Object storage reference. The rendered invoice carries a billing name from the
    -- identity vault, which is why the document lives outside this database.
    object_key          text,

    issued_at           timestamptz NOT NULL DEFAULT now(),
    -- Tax and accounting retention outlives the care relationship, and outlives a
    -- deletion request for everything else.
    retain_until        timestamptz NOT NULL
);

CREATE INDEX ON invoices (pseudo_id, issued_at DESC);
CREATE INDEX ON invoices (retain_until);

COMMENT ON COLUMN invoices.retain_until IS
    'Invoices survive account deletion, because tax law requires it. The deletion workflow must say so plainly rather than claiming an erasure it cannot perform.';

COMMIT;
