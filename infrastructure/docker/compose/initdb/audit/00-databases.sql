-- Audit instance bootstrap. Runs once, on first container init.
--
-- Alone on its own instance so it survives an attacker who owns the application
-- database — otherwise they erase their own tracks (backend-requirements §8).
--
-- The application role holds INSERT only. No UPDATE, no DELETE, in any environment,
-- and no SELECT either: a service that cannot read the log it writes to cannot
-- enumerate who accessed what.

CREATE DATABASE audit_vault;
COMMENT ON DATABASE audit_vault IS
    'Append-only, hash-chained, tamper-evident. Every service writes through an INSERT-only role; only audit-service reads. Sealed periodically to WORM object storage.';
