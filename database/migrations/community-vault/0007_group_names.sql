-- The name a member goes by inside one therapy group.
--
-- A member types it once, before their first session in a group, and it is then fixed
-- for every session of that group. Joining a different group means a new row and a new
-- name. The name can be anything the member chooses, including their real first name:
-- the group is seven people and a therapist, and some people find the honesty helps.
--
-- WHY IT IS FIXED
--
-- The people in a closed group come to know each other by this name over the whole
-- cycle. A name that could change between sessions would make the circle a room of
-- strangers each week, and would let somebody reappear as someone else.
--
-- The lock is the grant, not application code: 0012_group_names.sql gives
-- pseudonym_service SELECT, INSERT and DELETE on this table and no UPDATE. A bug in
-- the service cannot rename anybody. DELETE exists only for erasure, and is also
-- reached by the cascade when the persona itself is purged.
--
-- WHY IT IS NOT ON pseudo_profiles
--
-- The handle is public across the whole platform. This name is shown only to the
-- members of one group, and may be a real first name. Keeping it in its own table,
-- keyed by group, means no query that reads personas for the community feed can pick
-- it up by accident.
--
-- WHERE IT SHOULD END UP
--
-- care-therapy-service owns group memberships, but has no schema yet. Until it does,
-- group_id is the frontend's identifier for the group and is not checked against a
-- membership. When group_memberships exists, this should move there or gain a foreign
-- key to it.

BEGIN;

CREATE TABLE group_names (
    pseudo_id   bigint      NOT NULL REFERENCES pseudo_profiles(pseudo_id) ON DELETE CASCADE,
    group_id    text        NOT NULL CHECK (group_id ~ '^[a-z0-9-]{3,64}$'),
    name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 24),
    set_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (pseudo_id, group_id)
);

COMMENT ON TABLE group_names IS
    'The name a member goes by inside one therapy group. Set once per group and never updated; shown only to that group.';

COMMIT;
