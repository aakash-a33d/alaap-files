-- Member-chosen usernames removed. Every handle is drawn.
--
-- 0003 added a path for a member to replace their drawn handle with a name they
-- picked. That path is gone, and this migration removes what supported it.
--
-- WHY IT WAS REMOVED, since the audit trail will outlive the memory of it: a name
-- somebody chooses is almost always a name they already use elsewhere. The moment it
-- is reused here, everything that account has written about its own mental health is
-- searchable back to a real identity — by an employer, a relative, anyone who thinks
-- to try it. The platform cannot see that reuse and cannot undo it once posts exist.
-- Informed consent was the only available control and it was not a good enough one,
-- because the cost lands years later on the person least able to weigh it today.
--
-- A drawn handle cannot carry that link, because nobody chose it.
--
-- WHAT STAYS
--
-- `handle_normalised` stays, and keeps its unique index. It no longer has anything to
-- do with impersonation — nobody can register `Rahu1` beside `Rahul` when nobody
-- registers anything — but it is what makes account recovery survive a handle copied
-- off paper by somebody who has lost their phone. `SlowTide-2093`, `slowtide2093` and
-- `SlowTide-2O93` all resolve to one account.
--
-- Handles issued under earlier schemes are left exactly as they are. They are valid,
-- they resolve, and reissuing them would change the name on somebody's posts without
-- being asked. HANDLE_PATTERN accepts 4-6 digits for that reason.

BEGIN;

ALTER TABLE pseudo_profiles
  DROP CONSTRAINT IF EXISTS pseudo_profiles_handle_set_at_check,
  DROP CONSTRAINT IF EXISTS pseudo_profiles_handle_source_check;

ALTER TABLE pseudo_profiles
  DROP COLUMN IF EXISTS handle_source,
  DROP COLUMN IF EXISTS handle_set_at;

COMMENT ON COLUMN pseudo_profiles.handle IS
  'Display form. Permanent, and always drawn from metadata/pseudonyms/handle-words.v1.yaml — never supplied by the member.';
COMMENT ON COLUMN pseudo_profiles.handle_normalised IS
  'Uniqueness key and recovery lookup: case-folded, separators stripped, digit lookalikes folded. A transcription aid for somebody typing their handle off paper — see domain/handle.ts.';

COMMIT;
