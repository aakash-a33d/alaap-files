-- Remove the reply-visibility gating that was designed and then deliberately dropped.
--
-- WHAT THIS DELETES
--
--   community_comments.hidden_from_author   a reply the author was not allowed to read
--   community_comments.reply_ordinal        which replies became visible on upgrade
--   post_visibility_rules                   the per-post limit and the plan snapshot
--
-- WHY
--
-- An earlier design let a free-plan author see only the first two replies on their own
-- post; the rest were stored and withheld until they paid. The plans metadata records
-- why that went:
--
--   "That saved nothing - the reply had already been composed, scored, stored and
--    reviewed by the time the interface decided whether to show it - and it placed an
--    upgrade prompt in front of someone in acute distress."
--
-- Nothing has written these since community-service was built. Three guards already
-- stand against the idea returning: `replies-to-your-own-post` in the catalogue's
-- `never_gated`, `assertNeverGated` in the domain, and a test that fails if either is
-- removed. This migration removes the fourth thing - the columns themselves - because
-- a schema that still has somewhere to put a hidden reply is an invitation to write
-- one, and the next person reading the table has no way to know it was abandoned.
--
-- SAFE TO RUN
--
-- Every row is unused: `hidden_from_author` is false everywhere, `reply_ordinal` is
-- null everywhere, and `post_visibility_rules` is empty. The guard below refuses to
-- proceed if that is ever untrue, rather than destroying data somebody did write.
--
-- Ordered after the grant files, like 0002: 0001_roles.shared.sql grants on
-- post_visibility_rules, so dropping it earlier would make a fresh --reset fail on a
-- missing relation.

BEGIN;

-- Refuse rather than destroy. If any of these hold real data, the assumption behind
-- this migration is wrong and it must be re-examined, not forced through.
DO $$
DECLARE
    hidden_count integer;
    ordinal_count integer;
    rules_count integer;
BEGIN
    SELECT count(*) INTO hidden_count FROM community_comments WHERE hidden_from_author;
    SELECT count(*) INTO ordinal_count FROM community_comments WHERE reply_ordinal IS NOT NULL;
    SELECT count(*) INTO rules_count FROM post_visibility_rules;

    IF hidden_count > 0 OR ordinal_count > 0 OR rules_count > 0 THEN
        RAISE EXCEPTION
            'refusing to drop reply-visibility columns: % hidden replies, % ordinals, % visibility rules. '
            'Something wrote these, so the assumption that the feature is dead is wrong.',
            hidden_count, ordinal_count, rules_count;
    END IF;
END $$;

-- The index exists only to order replies for the upgrade reveal.
DROP INDEX IF EXISTS community_comments_post_id_reply_ordinal_idx;

ALTER TABLE community_comments
    DROP COLUMN IF EXISTS hidden_from_author,
    DROP COLUMN IF EXISTS reply_ordinal;

DROP TABLE IF EXISTS post_visibility_rules;

COMMENT ON TABLE community_comments IS
    'Replies. Every published reply is visible to the post author on every plan - quotas cap what a member may WRITE, never what they may read. See metadata/catalog/plans/plans.v1.yaml, never_gated.';

COMMIT;
