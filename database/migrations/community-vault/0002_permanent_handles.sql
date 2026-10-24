-- community-vault / 0002_permanent_handles
--
-- One permanent handle per persona, replacing the rotating-handle design.
--
-- WHAT THIS TRADES AWAY, stated here because the architecture argued the other way
-- and a future reader deserves to know this was deliberate.
--
-- §3.2 and §12N specified ROTATING public handles, and the property they bought was
-- unlinkability across time: a member who posted about a family situation in January
-- and about work in June could not be joined up by anyone reading both. A permanent
-- handle makes that join trivial for any observer, which on a mental health community
-- is the main residual privacy risk of pseudonymous posting.
--
-- WHAT IT BUYS
--
--   * a handle a member can be told, remember, and type — so it can serve as the
--     username on a login screen, which usernameless passkey login cannot cover for
--     someone recovering on a new device
--   * recognisability inside a circle or a baithak over months, which is what makes
--     a small group feel like the same people each week
--   * reports and appeals that stay resolvable without a rotation log
--
-- The five-day post expiry still bounds what is linkable: a permanent handle joins up
-- only what is currently visible, not an archive, unless the author chose to keep a
-- post at expiry.
--
-- Reasoning: founder decision, 11 September 2026. Supersedes the rotation design in
-- architecture §3.2 and §12N.

BEGIN;

-- ---------------------------------------------------------------------------
-- The handle moves onto the persona
-- ---------------------------------------------------------------------------

ALTER TABLE pseudo_profiles ADD COLUMN handle text;

-- Carry across whatever handle is currently live for each persona.
UPDATE pseudo_profiles p
SET handle = h.handle
FROM public_handles h
WHERE h.pseudo_id = p.pseudo_id AND h.retired_at IS NULL;

-- A persona with no live handle should not exist, but a migration that silently
-- leaves NULLs behind would fail the NOT NULL below with no explanation of which
-- rows. Fail loudly instead.
DO $$
DECLARE orphans integer;
BEGIN
    SELECT count(*) INTO orphans FROM pseudo_profiles WHERE handle IS NULL;
    IF orphans > 0 THEN
        RAISE EXCEPTION '% persona(s) have no live handle — cannot make handle NOT NULL', orphans;
    END IF;
END $$;

ALTER TABLE pseudo_profiles ALTER COLUMN handle SET NOT NULL;
ALTER TABLE pseudo_profiles ADD CONSTRAINT pseudo_profiles_handle_key UNIQUE (handle);

COMMENT ON COLUMN pseudo_profiles.handle IS
    'Permanent. One handle per persona, and therefore one per verified mobile number. Doubles as the username on a login screen. Changing it is an account-level operation with a deliberate cost, not a routine rotation.';

-- ---------------------------------------------------------------------------
-- The rotation machinery goes
-- ---------------------------------------------------------------------------
--
-- Dropped rather than left empty. A table nobody writes to is a table somebody
-- eventually reads and draws a wrong conclusion from, and `public_handles` in
-- particular would imply a history that no longer accumulates.
--
-- The grants on both tables disappear with them. `community_service` and
-- `moderation_service` already hold SELECT on `pseudo_profiles`, which is where the
-- handle now lives, so nothing needs re-granting.

DROP TABLE pseudonym_rotation_logs;
DROP TABLE public_handles;

COMMIT;
