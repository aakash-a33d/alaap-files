/**
 * Which services are asked to purge, and in what order.
 *
 * ORDER IS LOAD-BEARING
 *
 * pseudonym-service is last, always. Its row is the only thing that makes a pseudo id
 * resolvable to a handle, and therefore to anything a person said. Deleting it first
 * would leave every other purge working against an identifier nothing could explain —
 * and if the run then failed halfway, the member would be left with orphaned content
 * and no handle to find it by.
 *
 * auth-service is second to last, for the same reason from the other side: its account
 * row carries the blind index over the mobile number, which is the last link between a
 * person and the pseudonym. Once it is gone, nothing that remains points at anybody.
 *
 * Content vaults go first, while the member is still identifiable enough to be told
 * precisely what happened in each.
 *
 * ON THE IDENTITY VAULT
 *
 * It is not in this list, and that is a statement of fact rather than an omission.
 * identity-vault-service is unbuilt, nothing writes to `identity_vault_records`, and
 * the only trace of a mobile number anywhere today is the blind index in
 * `auth_accounts` — which auth-service's purge destroys. When that service is built and
 * holds real numbers, it belongs in this list ahead of auth-service, and the privacy
 * suite should fail until it is there.
 */

export interface PurgeTarget {
  /** Service id, as it appears in metadata/api/service-registry.v1.yaml. */
  service: string;
  /** Environment variable naming its base URL. */
  upstreamEnv: string;
  /** What the member is told this step covered. */
  label: string;
}

export const PURGE_ORDER: readonly PurgeTarget[] = [
  {
    service: 'community-service',
    upstreamEnv: 'UPSTREAM_COMMUNITY_SERVICE',
    label: 'your posts and replies',
  },
  {
    service: 'clinical-vault-service',
    upstreamEnv: 'UPSTREAM_CLINICAL_VAULT_SERVICE',
    label: 'your journal and mood check-ins',
  },
  {
    service: 'consent-service',
    upstreamEnv: 'UPSTREAM_CONSENT_SERVICE',
    label: 'your consent records',
  },
  {
    service: 'auth-service',
    upstreamEnv: 'UPSTREAM_AUTH_SERVICE',
    label: 'your account, sessions and devices',
  },
  {
    service: 'pseudonym-service',
    upstreamEnv: 'UPSTREAM_PSEUDONYM_SERVICE',
    label: 'your handle',
  },
];

/** The same services, for an export. Same order; it only affects how the file reads. */
export const EXPORT_ORDER = PURGE_ORDER;
