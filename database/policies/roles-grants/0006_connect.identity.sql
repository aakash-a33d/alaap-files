-- Database CONNECT privileges — IDENTITY INSTANCE.
--
-- Same finding as 0005_connect.shared.sql. Here the exposure was already the
-- narrowest on the platform, because no foreign role exists on this cluster at all —
-- a community or billing role attempting to connect is refused with "role does not
-- exist" rather than a permission error.
--
-- Revoking PUBLIC still matters: it means a role added here later for some good
-- reason does not silently inherit the ability to open a session against the identity
-- vault and read its table names.

REVOKE CONNECT ON DATABASE identity_vault FROM PUBLIC;
GRANT  CONNECT ON DATABASE identity_vault
    TO identity_vault_service, break_glass_service;
