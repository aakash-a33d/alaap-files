-- Identity instance bootstrap. Runs once, on first container init.
--
-- One database, alone on its own instance and its own network segment. It holds the
-- records whose disclosure cannot be undone: legal names, verified mobile numbers,
-- emergency contacts, subsidy eligibility documents.
--
-- The isolation is for CONTAINMENT, not scale (backend-requirements §1). A
-- memory-disclosure bug in community code must not be able to reach these rows, and
-- the only paths in are the identity and break-glass service APIs.

CREATE DATABASE identity_vault;
COMMENT ON DATABASE identity_vault IS
    'Real identity. Reachable only through identity-vault-service and break-glass-service, both of which declare api_groups: [] and are unreachable from the frontend. Stores no community posts, journals or moderation history. Schema arrives in M1.';
