# infrastructure

Docker, Kubernetes, Terraform, KMS, networking, monitoring, logging and CI/CD.

The development machine runs the full stack locally through `docker/compose`. It is
not a production environment. Production requires replicated managed PostgreSQL,
separate encrypted object storage, managed KMS/HSM, Redis, container orchestration,
CDN/WAF, application monitoring, SIEM, a backup region, and GPU inference nodes
separate from the application tier.

`secrets/` holds templates and sealed secrets only — never plaintext values.
`logging/redaction-rules/` is mandatory: logs must not carry journal content, message
bodies, phone numbers or identity fields.
