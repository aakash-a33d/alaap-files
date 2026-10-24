/**
 * Stage 3 — role check, and the step-up assertion that goes with it.
 *
 * Coarse only. "Is a moderator allowed to reach /api/moderator" is a gateway
 * question. "Is THIS moderator allowed to see THIS report" is not — the gateway does
 * not know, and pretending otherwise would be a correctness bug disguised as a
 * security boundary (backend-requirements §9).
 */

import type { NextFunction, Request, Response } from 'express';

import { SessionStore } from '../../infrastructure/session-store.ts';
import { GatewayError } from '../../types.ts';

export function roleCheck() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const { group, session } = req.ctx;
    if (group === undefined) {
      next(new GatewayError(500, 'pipeline_order', 'Internal error.', 'rbac before route'));
      return;
    }

    if (group.authentication === 'none') {
      next();
      return;
    }

    if (session === undefined) {
      next(new GatewayError(401, 'no_session', 'Sign in to continue.'));
      return;
    }

    if (!group.roles.includes(session.actorRole)) {
      // 404, not 403. A member probing /api/admin should not learn that it exists
      // and that they are merely the wrong role for it.
      next(
        new GatewayError(
          404,
          'role_not_permitted',
          'Not found.',
          `role ${session.actorRole} not in [${group.roles.join(', ')}] for ${group.prefix}`,
        ),
      );
      return;
    }

    if (group.stepUp && !SessionStore.hasStepUp(session, group.prefix)) {
      // 403 with a distinct code, because this one the client must act on — it
      // triggers the step-up verification flow rather than a sign-in.
      next(
        new GatewayError(
          403,
          'step_up_required',
          'Please verify it is you to continue.',
          `no live step-up assertion scoped to ${group.prefix}`,
        ),
      );
      return;
    }

    next();
  };
}
