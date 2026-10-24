-- Member-chosen usernames.
--
-- 0002 made the handle permanent: one per persona, one per verified mobile number.
-- This migration keeps that and adds a second way to get one — the member picks it
-- instead of accepting what the platform drew.
--
-- WHAT THIS TRADES AWAY, stated here because the column is where it becomes real.
--
-- A generated username is unlinkable. Nothing about `qnv8dh2xrk` connects to a
-- person, which is why the platform could promise that what you write here stays
-- separate from who you are. A chosen username usually breaks that promise, not
-- because the feature is flawed but because of how people behave: they reuse the
-- name they already have on Instagram, on Reddit, in an email address. The moment
-- they do, every post on this platform is searchable back to a real identity.
--
-- The platform cannot see other sites and cannot detect the reuse. So the control is
-- consent that is actually informed — the API refuses a claim that does not carry an
-- explicit acknowledgement, and every claim writes pseudonym.username.chosen to the
-- audit vault. If this is ever litigated or reviewed, the record shows the member was
-- told and chose anyway, with a timestamp.
--
-- THREE COLUMNS, THREE JOBS
--
--   handle              what gets displayed, exactly as it was typed
--   handle_normalised   the uniqueness key, case- and confusable-folded
--   handle_source       generated or chosen; also enforces the once-only claim
--
-- The normalised column is the impersonation control. Without it `rahu1` and `rahul`
-- are two accounts that look identical in a feed, and on a platform where members
-- disclose things to people they believe they recognise, that is not cosmetic.

BEGIN;

ALTER TABLE pseudo_profiles
  ADD COLUMN handle_normalised text,
  ADD COLUMN handle_source     text NOT NULL DEFAULT 'generated'
    CONSTRAINT pseudo_profiles_handle_source_check
    CHECK (handle_source IN ('generated', 'chosen')),
  ADD COLUMN handle_set_at     timestamptz;

-- Backfill. Must apply exactly the folding in domain/username.ts — case down,
-- separators out, strong lookalikes mapped to one canonical letter. The digit map is
-- injective and no target is also a source, so this cannot collapse two of the
-- existing word-pair handles onto each other; if it somehow did, the unique index
-- below refuses to build and the transaction rolls back rather than silently merging
-- two people's identities.
UPDATE pseudo_profiles
SET handle_normalised = translate(lower(translate(handle, '._-', '')), '013457@$', 'oleastas');

ALTER TABLE pseudo_profiles
  ALTER COLUMN handle_normalised SET NOT NULL;

CREATE UNIQUE INDEX pseudo_profiles_handle_normalised_key
  ON pseudo_profiles (handle_normalised);

-- Everything that exists now was drawn by the platform, so 'generated' is correct for
-- every row and the DEFAULT above already applied it. Drop the default: from here on
-- the source is a fact the caller must state, not something a missing value decides.
ALTER TABLE pseudo_profiles
  ALTER COLUMN handle_source DROP DEFAULT;

-- A chosen username records when it was claimed; a generated one has nothing to
-- record, since it was there from the moment the persona existed. Anything else is a
-- row that says a member chose a name at a time when they had not.
ALTER TABLE pseudo_profiles
  ADD CONSTRAINT pseudo_profiles_handle_set_at_check
  CHECK (
    (handle_source = 'generated' AND handle_set_at IS NULL) OR
    (handle_source = 'chosen'    AND handle_set_at IS NOT NULL)
  );

COMMENT ON COLUMN pseudo_profiles.handle IS
  'Display form, as typed. Permanent.';
COMMENT ON COLUMN pseudo_profiles.handle_normalised IS
  'Uniqueness key: case-folded, separators stripped, confusables folded. Impersonation control — see domain/username.ts.';
COMMENT ON COLUMN pseudo_profiles.handle_source IS
  'generated = drawn by the platform, unlinkable. chosen = picked by the member, who acknowledged the linkability risk. Claimed once; the claim is enforced by UPDATE ... WHERE handle_source = ''generated''.';

COMMIT;
