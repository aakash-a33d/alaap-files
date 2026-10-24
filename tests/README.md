# tests

Cross-cutting suites that span more than one package. Unit tests live beside the code
they cover, inside each service or app.

| Path | Verifies |
| --- | --- |
| `contract/` | Service-to-service contracts against `metadata/api` |
| `integration/` | Multi-service workflows |
| `e2e/` | The eight end-to-end workflows: registration, anonymous post, hidden reply unlock, group care, one-to-one care, therapist AI, crisis, export/deletion |
| `security/` | Authz bypass, session handling, injection, rate limiting |
| `privacy/` | The negative assertions — that moderators cannot see identity, therapists cannot see unconsented records, AI never receives forbidden fields, deletion actually purges |
| `accessibility/` | WCAG checks across every portal |
| `performance/` | Load and latency budgets |
| `ai-safety/` | Crisis-language handling, false positives/negatives, language bias, privacy leakage |

`privacy/` is a release gate, not an optional suite.
