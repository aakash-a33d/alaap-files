/**
 * The gateway's audit writer.
 *
 * Previously a full implementation living here. It now comes from
 * packages/audit-client, because seventeen services must not each grow their own
 * INSERT with their own idea of what belongs in `context` — the allowlist that keeps
 * content out of the audit vault only works if there is one of it.
 *
 * This file stays as the gateway's seam onto that package: it supplies the
 * gateway-specific application name and re-exports the types the middleware uses, so
 * the middleware does not reach across the workspace for them.
 */

import { PostgresAuditClient } from '@alaap/audit-client';

export type {
  AccessResult,
  ActorRole,
  AuditClient,
  AuditEvent,
  ConsentDecision,
} from '@alaap/audit-client';
export { AuditWriteError, gatewayActionType } from '@alaap/audit-client';

export function createAuditClient(
  connectionString: string,
  onDroppedContext?: (keys: string[]) => void,
  onPoolError?: (err: Error) => void,
): PostgresAuditClient {
  return new PostgresAuditClient({
    connectionString,
    applicationName: 'alaap-gateway',
    ...(onDroppedContext !== undefined ? { onDroppedContext } : {}),
    ...(onPoolError !== undefined ? { onPoolError } : {}),
  });
}

export { PostgresAuditClient };
