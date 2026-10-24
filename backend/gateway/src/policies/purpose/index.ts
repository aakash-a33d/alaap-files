/**
 * Stage 5 — purpose limitation.
 *
 * Two checks, and the first matters more than it looks.
 *
 * 1. THE CALLER MAY NOT CHOOSE THE PURPOSE. The purpose comes from the route policy
 *    in metadata and nowhere else. If a client could declare its own, it could
 *    request clinical data under `community-moderation` and the audit trail would
 *    record a lie. This is checked by rejecting the request outright rather than by
 *    quietly overwriting, because a caller sending one is either broken or probing.
 *
 * 2. THE PURPOSE MUST COVER THE VAULTS THE ROUTE'S SERVICE CAN REACH. A route into
 *    clinical-vault-service declaring a purpose registered only for the community
 *    vault is a policy error, and the boot check cannot catch it because the vault
 *    matrix is a separate document.
 */

import type { NextFunction, Request, Response } from 'express';

import type { RegisteredPurpose } from '../../config/metadata.ts';
import { GatewayError } from '../../types.ts';

/**
 * Which vault each routable service reads, from the vault access matrix. Only the
 * `effective` column matters here — what the service can ultimately obtain.
 *
 * This mirrors metadata/access-control/vault-access-matrix/. It is duplicated rather
 * than loaded because the gateway needs only the coarse mapping, and tests/privacy/
 * asserts the two stay in agreement.
 */
const SERVICE_VAULTS: Readonly<Record<string, readonly string[]>> = {
  'auth-service': ['identity'],
  'pseudonym-service': ['community'],
  'community-service': ['community', 'billing'],
  'moderation-service': ['community'],
  'consent-service': ['clinical'],
  'clinical-vault-service': ['clinical'],
  'care-therapy-service': ['identity', 'clinical', 'billing'],
  'therapist-service': ['clinical', 'billing'],
  'billing-subsidy-service': ['identity', 'billing'],
  'safety-crisis-service': ['identity', 'community', 'clinical'],
  'break-glass-service': ['identity', 'clinical'],
  'notification-service': ['identity'],
  'retention-service': ['identity', 'community', 'clinical', 'billing'],
  'admin-service': ['identity', 'community', 'billing', 'audit'],
  'partner-service': ['billing'],
};

export function purposeLimitation(purposes: Map<string, RegisteredPurpose>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const group = req.ctx.group;
    if (group === undefined) {
      next(new GatewayError(500, 'pipeline_order', 'Internal error.', 'purpose before route'));
      return;
    }

    // (1) The header strip in request-context already removed x-alaap-*, so this
    // catches the query and body forms. Reject, never silently ignore.
    const smuggled =
      req.query['purpose'] !== undefined ||
      (typeof req.body === 'object' &&
        req.body !== null &&
        Object.hasOwn(req.body as object, 'purpose'));

    if (smuggled) {
      next(
        new GatewayError(
          400,
          'purpose_not_caller_supplied',
          'Bad request.',
          'caller attempted to declare its own purpose',
        ),
      );
      return;
    }

    const declared = group.purpose;
    if (declared === undefined) {
      next();
      return;
    }

    // (2)
    const purpose = purposes.get(declared);
    if (purpose === undefined) {
      next(new GatewayError(500, 'unregistered_purpose', 'Internal error.'));
      return;
    }

    const reachable = SERVICE_VAULTS[group.service];
    if (reachable !== undefined) {
      const covered = reachable.some((v) => purpose.vaults.includes(v));
      if (!covered) {
        next(
          new GatewayError(
            500,
            'purpose_vault_mismatch',
            'Internal error.',
            `purpose "${declared}" covers [${purpose.vaults.join(', ')}] but ` +
              `${group.service} reaches [${reachable.join(', ')}]`,
          ),
        );
        return;
      }
    }

    next();
  };
}

export const __testing = { SERVICE_VAULTS };
