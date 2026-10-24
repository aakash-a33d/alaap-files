-- community-vault / 0001_community
--
-- Anonymous posts, replies, moderation verdicts, reports and appeals.
--
-- This vault stores message text, because moderation must run before publication
-- (§12D). It is therefore encrypted in transit and at rest but is NOT end-to-end
-- encrypted, and that limit is stated to users rather than hidden.
--
-- What must never appear here: legal name, phone number, address, emergency contact,
-- government ID, therapist name, payment method, subsidy document.
--
-- Co-tenanted by three services over disjoint table sets:
--   pseudonym-service   pseudo_profiles, public_handles, block_lists, rotation logs
--   community-service   posts, comments, visibility, reports, restrictions
--   moderation-service  verdicts, reviews, appeals, policy versions
--
-- Reasoning: docs/backend/backend-requirements.md §2

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===========================================================================
-- pseudonym-service
-- ===========================================================================

CREATE TABLE pseudo_profiles (
    pseudo_id           bigint PRIMARY KEY,
    created_at          timestamptz NOT NULL DEFAULT now(),

    -- Deliberately no account_id, no mobile hash, no identity reference of any kind.
    -- Resolving a pseudo_id to a person is an application-layer operation that
    -- crosses a vault boundary and requires a consent or break-glass check.

    avatar_seed         text        NOT NULL,
    avatar_style        text        NOT NULL DEFAULT 'identicon',
    status              text        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','restricted','suspended','closed'))
);

COMMENT ON TABLE pseudo_profiles IS
    'The public persona. This table must never gain a column that references the identity vault, however convenient it would be.';

CREATE TABLE public_handles (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pseudo_id           bigint      NOT NULL REFERENCES pseudo_profiles(pseudo_id) ON DELETE CASCADE,
    handle              text        NOT NULL UNIQUE,
    issued_at           timestamptz NOT NULL DEFAULT now(),
    retired_at          timestamptz
);

-- Exactly one live handle per persona.
CREATE UNIQUE INDEX one_live_handle_per_pseudo
    ON public_handles (pseudo_id) WHERE retired_at IS NULL;

CREATE TABLE pseudonym_rotation_logs (
    id                  bigserial PRIMARY KEY,
    pseudo_id           bigint      NOT NULL REFERENCES pseudo_profiles(pseudo_id) ON DELETE CASCADE,
    old_handle          text        NOT NULL,
    new_handle          text        NOT NULL,
    rotated_at          timestamptz NOT NULL DEFAULT now(),
    reason              text        NOT NULL DEFAULT 'scheduled'
                        CHECK (reason IN ('scheduled','user_request','safety','abuse'))
);

CREATE TABLE block_lists (
    blocker_pseudo_id   bigint      NOT NULL REFERENCES pseudo_profiles(pseudo_id) ON DELETE CASCADE,
    blocked_pseudo_id   bigint      NOT NULL REFERENCES pseudo_profiles(pseudo_id) ON DELETE CASCADE,
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_pseudo_id, blocked_pseudo_id),
    CONSTRAINT no_self_block CHECK (blocker_pseudo_id <> blocked_pseudo_id)
);

-- ===========================================================================
-- community-service
-- ===========================================================================

CREATE TABLE community_categories (
    id                  text PRIMARY KEY,
    display_order       integer     NOT NULL,
    active              boolean     NOT NULL DEFAULT true
);

COMMENT ON TABLE community_categories IS
    'Ids only. Labels and translations come from metadata/catalog, never from here.';

CREATE TABLE community_posts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Display identifier shown as P-883920. Separate from the primary key so the
    -- internal id is not enumerable from the interface.
    public_ref          text        NOT NULL UNIQUE,

    author_pseudo_id    bigint      NOT NULL REFERENCES pseudo_profiles(pseudo_id) ON DELETE CASCADE,
    category_id         text        NOT NULL REFERENCES community_categories(id),

    body                text        NOT NULL,

    state               text        NOT NULL DEFAULT 'pending_moderation'
                        CHECK (state IN ('pending_moderation','published','held','blocked','expired','deleted')),

    -- The AI supportive response is asynchronous (§ AI requirements). A post is
    -- published before it exists, and this column tracks that.
    ai_response_state   text        NOT NULL DEFAULT 'pending'
                        CHECK (ai_response_state IN ('pending','ready','failed','suppressed')),

    created_at          timestamptz NOT NULL DEFAULT now(),
    published_at        timestamptz,
    expires_at          timestamptz,
    deleted_at          timestamptz,

    -- Retained past expiry only under a narrowly scoped abuse, appeal or legal hold.
    legal_hold          boolean     NOT NULL DEFAULT false,

    CONSTRAINT published_posts_expire
        CHECK (state <> 'published' OR expires_at IS NOT NULL)
);

CREATE INDEX ON community_posts (author_pseudo_id, created_at DESC);
CREATE INDEX ON community_posts (category_id, published_at DESC)
    WHERE state = 'published';
CREATE INDEX ON community_posts (expires_at)
    WHERE state = 'published' AND legal_hold = false;

COMMENT ON COLUMN community_posts.expires_at IS
    'Five days from publication for free posts (§5.1). The retention worker reads this index; nothing relies on a scheduled scan of the whole table.';

CREATE TABLE community_comments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_ref          text        NOT NULL UNIQUE,
    post_id             uuid        NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    parent_comment_id   uuid        REFERENCES community_comments(id) ON DELETE CASCADE,

    author_pseudo_id    bigint      NOT NULL REFERENCES pseudo_profiles(pseudo_id) ON DELETE CASCADE,
    body                text        NOT NULL,

    -- Distinguishes the one AI supportive response from peer replies.
    source              text        NOT NULL DEFAULT 'peer'
                        CHECK (source IN ('peer','ai')),

    state               text        NOT NULL DEFAULT 'pending_moderation'
                        CHECK (state IN ('pending_moderation','published','held','blocked','deleted')),

    -- Free-plan authors see two replies; the rest are stored and hidden until they
    -- upgrade (§5.2). Responders are never told their reply is hidden.
    hidden_from_author  boolean     NOT NULL DEFAULT false,

    -- Ordinal among published peer replies, assigned at publication. Determines
    -- which replies become visible on upgrade, so the order never shifts.
    reply_ordinal       integer,

    created_at          timestamptz NOT NULL DEFAULT now(),
    published_at        timestamptz,
    deleted_at          timestamptz
);

CREATE INDEX ON community_comments (post_id, reply_ordinal)
    WHERE state = 'published';
CREATE INDEX ON community_comments (author_pseudo_id, created_at DESC);

-- At most one AI response per post.
CREATE UNIQUE INDEX one_ai_response_per_post
    ON community_comments (post_id) WHERE source = 'ai';

CREATE TABLE post_visibility_rules (
    post_id             uuid PRIMARY KEY REFERENCES community_posts(id) ON DELETE CASCADE,

    -- Snapshot of the author's plan at publication. Later downgrades must not
    -- retroactively re-hide replies the author has already seen.
    author_plan_tier    text        NOT NULL
                        CHECK (author_plan_tier IN ('free','interaction_plus','group_care','individual_care')),
    visible_reply_limit integer     NOT NULL,
    unlocked_at         timestamptz,
    updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE post_visibility_rules IS
    'Written by community-service from a plan tier read over the billing-subsidy-service API. The community vault never holds payment state.';

CREATE TABLE user_reports (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_pseudo_id  bigint      NOT NULL REFERENCES pseudo_profiles(pseudo_id) ON DELETE CASCADE,

    subject_type        text        NOT NULL CHECK (subject_type IN ('post','comment')),
    subject_post_id     uuid        REFERENCES community_posts(id) ON DELETE CASCADE,
    subject_comment_id  uuid        REFERENCES community_comments(id) ON DELETE CASCADE,

    reason_code         text        NOT NULL,
    note                text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    resolved_at         timestamptz,
    outcome             text CHECK (outcome IN ('upheld','rejected','duplicate','no_action')),

    CONSTRAINT report_targets_exactly_one_subject CHECK (
        (subject_type = 'post'    AND subject_post_id IS NOT NULL AND subject_comment_id IS NULL) OR
        (subject_type = 'comment' AND subject_comment_id IS NOT NULL AND subject_post_id IS NULL)
    )
);

CREATE INDEX ON user_reports (resolved_at) WHERE resolved_at IS NULL;

CREATE TABLE account_restrictions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pseudo_id           bigint      NOT NULL REFERENCES pseudo_profiles(pseudo_id) ON DELETE CASCADE,
    restriction         text        NOT NULL
                        CHECK (restriction IN ('rate_limited','posting_blocked','commenting_blocked','suspended')),
    reason_code         text        NOT NULL,
    applied_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz,
    lifted_at           timestamptz
);

CREATE INDEX ON account_restrictions (pseudo_id)
    WHERE lifted_at IS NULL;

-- ===========================================================================
-- moderation-service
-- ===========================================================================

CREATE TABLE moderation_policy_versions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version             integer     NOT NULL UNIQUE,
    published_at        timestamptz NOT NULL DEFAULT now(),
    retired_at          timestamptz,
    notes               text
);

COMMENT ON TABLE moderation_policy_versions IS
    'Append-only. A published version is superseded, never edited, because verdicts and appeals reference the policy that actually produced them.';

CREATE TABLE moderation_categories (
    id                  text PRIMARY KEY,
    severity            smallint    NOT NULL CHECK (severity BETWEEN 1 AND 5),
    active              boolean     NOT NULL DEFAULT true
);

CREATE TABLE moderation_verdicts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    subject_type        text        NOT NULL CHECK (subject_type IN ('post','comment')),
    subject_post_id     uuid        REFERENCES community_posts(id) ON DELETE CASCADE,
    subject_comment_id  uuid        REFERENCES community_comments(id) ON DELETE CASCADE,

    decision            text        NOT NULL
                        CHECK (decision IN ('allowed','suggest_rewording','limited_visibility','blocked','crisis_flag','abuse_pattern')),

    -- Which categories fired. Thresholds and scores are deliberately not exposed
    -- to any interface (§6.3 — do not reveal model thresholds or evasion detail).
    categories          text[]      NOT NULL DEFAULT '{}',

    model_id            text        NOT NULL,
    model_version       text        NOT NULL,
    policy_version      integer     NOT NULL REFERENCES moderation_policy_versions(version),

    decided_at          timestamptz NOT NULL DEFAULT now(),
    latency_ms          integer,

    CONSTRAINT verdict_targets_exactly_one_subject CHECK (
        (subject_type = 'post'    AND subject_post_id IS NOT NULL AND subject_comment_id IS NULL) OR
        (subject_type = 'comment' AND subject_comment_id IS NOT NULL AND subject_post_id IS NULL)
    )
);

CREATE INDEX ON moderation_verdicts (subject_post_id);
CREATE INDEX ON moderation_verdicts (subject_comment_id);
CREATE INDEX ON moderation_verdicts (decision, decided_at DESC);

COMMENT ON COLUMN moderation_verdicts.model_id IS
    'References an id in metadata/ai/model-registry. Kept so a verdict remains explainable after the model is retrained.';

CREATE TABLE moderation_reviews (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    verdict_id          uuid        NOT NULL REFERENCES moderation_verdicts(id) ON DELETE CASCADE,

    -- Moderator identity is a staff actor id from the core/admin domain, not a
    -- pseudo_id. No foreign key: it crosses a vault boundary.
    moderator_actor_id  uuid        NOT NULL,

    outcome             text        NOT NULL
                        CHECK (outcome IN ('confirmed','overturned','escalated','deferred')),
    reason_code         text        NOT NULL,
    note                text,
    reviewed_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON moderation_reviews (verdict_id);

CREATE TABLE moderation_appeals (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    verdict_id          uuid        NOT NULL REFERENCES moderation_verdicts(id) ON DELETE CASCADE,
    appellant_pseudo_id bigint      NOT NULL REFERENCES pseudo_profiles(pseudo_id) ON DELETE CASCADE,

    statement           text,
    state               text        NOT NULL DEFAULT 'open'
                        CHECK (state IN ('open','under_review','upheld','rejected','withdrawn')),

    created_at          timestamptz NOT NULL DEFAULT now(),
    resolved_at         timestamptz,
    resolution_note     text
);

CREATE INDEX ON moderation_appeals (state, created_at)
    WHERE state IN ('open','under_review');

-- One open appeal per verdict; a resolved appeal may be followed by another.
CREATE UNIQUE INDEX one_open_appeal_per_verdict
    ON moderation_appeals (verdict_id) WHERE state IN ('open','under_review');

COMMIT;
