-- pseudonym-service on `group_names` (community-vault/0007_group_names.sql).
--
-- SELECT and INSERT: read a member's name for a group, and set it the first time.
-- DELETE: erasure only.
--
-- Not UPDATE. A member's name in a group is fixed for the life of that group, and this
-- missing privilege is what fixes it. If the service ever tries to rename somebody,
-- the database refuses.

\connect community_vault

GRANT SELECT, INSERT, DELETE ON group_names TO pseudonym_service;
