-- Database CONNECT privileges — AUDIT INSTANCE.
--
-- Same finding as 0005_connect.shared.sql.
--
-- `audit_writer` needs CONNECT because every service writes here. It holds INSERT and
-- nothing else, so a connected writer still cannot read the log it appends to.

REVOKE CONNECT ON DATABASE audit_vault FROM PUBLIC;
GRANT  CONNECT ON DATABASE audit_vault TO audit_writer, audit_service;
