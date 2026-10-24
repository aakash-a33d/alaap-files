# packages

Shared libraries consumed by `frontend/`, `backend/` and (via generated bindings)
`ai-services/`.

| Package | Purpose |
| --- | --- |
| `shared-types` | Domain types generated from `metadata/data/dictionary` |
| `api-contracts` | Typed clients generated from `metadata/api/openapi` |
| `validation-schemas` | Zod schemas shared by form validation and request validation |
| `design-system` | Tokens, primitives and the calm-UI component set |
| `crypto-client` | Browser-side Web Crypto envelope encryption |
| `crypto-utils` | Server-side KMS/HSM envelope helpers |
| `auth-utils` | Session, passkey and step-up primitives |
| `consent-policy-engine` | The single implementation of "may this actor read this record for this purpose" |
| `pricing-engine` | Standard price minus applicable subsidy, shared by UI and billing |
| `pseudonym-kit` | Handle generation, rotation and identicon derivation |
| `audit-client` | Emits well-formed audit events, used by every service |
| `error-handling` | Error taxonomy from `metadata/api/errors` |
| `observability` | Tracing, metrics, redacted logging |
| `feature-flags`, `i18n-core`, `test-utils`, `config-eslint`, `config-typescript` | Support |
