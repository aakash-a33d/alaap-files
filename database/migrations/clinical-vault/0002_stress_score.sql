-- ---------------------------------------------------------------------------
-- Stress, which the dashboard has always asked for and never stored
-- ---------------------------------------------------------------------------
--
-- The check-in card collects three numbers — mood, sleep and stress — and the
-- chart has a Stress tab. Only two of them had a column. Stress was read off the
-- member, sent nowhere, and the chart drew a flat nothing with a note explaining
-- that there was no history to show.
--
-- Asking somebody how bad their day was and discarding the answer is worse than
-- not asking. It also made the one surface that is free on every plan, never
-- gated, and meant as the lowest-friction way in, quietly lossy.
--
-- Not folded into 0001_clinical.sql: that file is applied and its SHA-256 is in
-- the ledger, so editing it is refused. Privilege changes and schema changes are
-- appended, never rewritten.
--
-- Nullable deliberately. Rows written before this migration genuinely have no
-- stress value, and a default would invent one — the same lie as drawing a line
-- through a day nobody recorded.

ALTER TABLE mood_checkins
    ADD COLUMN stress_score smallint CHECK (stress_score BETWEEN 1 AND 10);

COMMENT ON COLUMN mood_checkins.stress_score IS
    'How heavy the day felt, 1-10, set by the member. Null means the check-in predates the column, not that the day was calm. Like the rest of this table it is a small integer, never free text: a stress note would be journal content wearing a different name.';
