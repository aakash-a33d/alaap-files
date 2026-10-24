-- Shared instance bootstrap. Runs once, on first container init.
--
-- Four databases on one cluster: core plus three vaults. They share an instance for
-- cost, not for convenience — each keeps its own database, its own role set and (in
-- production) its own encryption key and backup policy (backend-requirements §2).
--
-- `core` is deliberately outside the vault access matrix. It holds credentials —
-- accounts, passkeys, recovery codes, sessions — rather than one of the five
-- protected data domains, and including it would dilute what that matrix exists to
-- prevent.

CREATE DATABASE core;
COMMENT ON DATABASE core IS
    'Authentication state. Owned solely by auth-service. Not a protected data domain.';

CREATE DATABASE community_vault;
COMMENT ON DATABASE community_vault IS
    'Pseudonymous posts, comments, moderation. Co-tenanted by pseudonym, community and moderation services over disjoint table sets. Holds no real identity.';

CREATE DATABASE clinical_vault;
COMMENT ON DATABASE clinical_vault IS
    'Journals, mood logs, therapy records. Per-record encryption. Schema arrives in M7.';

CREATE DATABASE billing_vault;
COMMENT ON DATABASE billing_vault IS
    'Plans, payments, subsidies, payouts. Gateway token references only, never card data. Schema arrives in M7.';

-- Nothing is granted here. Roles and grants are applied by
-- database/policies/roles-grants/, after the migrations that create the tables.
-- Absence is denial.
