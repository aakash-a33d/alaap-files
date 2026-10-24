-- Move `user_reports` from community-service to moderation-service.
--
-- WHY THIS IS A NEW FILE AND NOT AN EDIT
--
-- 0001_roles.shared.sql is already applied, and the migration ledger stores its
-- SHA-256. Editing it would be refused as a changed checksum — correctly, because a
-- grant file that can be rewritten after the fact is a grant file nobody can audit.
-- Privilege changes are appended, like everything else.
--
-- THE INCONSISTENCY THIS RESOLVES
--
-- 0001 granted `user_reports` to community_service, alongside posts and comments. But
-- the route policy sends reporting to moderation-service:
--
--   /api/moderation -> moderation-service, "A member's own reports and appeals."
--
-- So the service that serves the route could not write the table, and the service that
-- could write it has no route and no code that touches it. That surfaced as
-- `permission denied for table user_reports` the first time a member reported a post.
--
-- A report is an input to adjudication, and adjudication is moderation-service's job:
-- it already owns verdicts, reviews and appeals, and a reviewer looking at a report
-- needs the verdict beside it. Reports belong with them.
--
-- WHAT COMMUNITY-SERVICE LOSES
--
-- Nothing it uses. It has no code that reads or writes `user_reports`. The grant is
-- revoked rather than left in place because an unused privilege is one that a later
-- change can reach for without anybody deciding it should — the same reasoning that
-- closed the PUBLIC CONNECT gap.
--
-- `account_restrictions` deliberately STAYS with community-service: applying a
-- restriction is an act on a member's ability to post, which is the posting service's
-- to enforce. moderation-service decides; community-service enforces.

\connect community_vault

GRANT SELECT, INSERT, UPDATE ON user_reports TO moderation_service;

-- Not DELETE. A report is evidence of what somebody objected to, and the outcome
-- column already records that a reviewer found nothing in it. Removing the row would
-- destroy the only trace that the objection was made.
REVOKE ALL ON user_reports FROM community_service;

COMMENT ON TABLE user_reports IS
    'Member reports. Owned by moderation-service: a report is an input to adjudication and a reviewer needs it beside the verdict. community-service enforces restrictions but does not hold reports.';
