/**
 * Stage 8 — the audit event.
 *
 * WHY THIS RUNS BEFORE THE PROXY AND NOT AFTER
 *
 * backend-requirements §8 states two things that look contradictory:
 *
 *   "Audit writes never block the request path"
 *   "a failed audit write fails the operation it was recording"
 *
 * They reconcile if the event records the gateway's ACCESS DECISION rather than the
 * downstream outcome. The decision is known before anything is forwarded, so writing
 * it here blocks nothing that has started, and a failed write means the operation
 * never happens — which is the only way the second rule can hold. Auditing after the
 * response would make it unenforceable: the data would already have been served.
 *
 * An unlogged sensitive access is not an acceptable outcome, so this stage fails
 * closed with 503. That is a deliberate availability cost.
 *
 * Denials are audited too, and audited first — a burst of denied break-glass attempts
 * is exactly the signal the audit vault exists to preserve.
 */

import type { NextFunction, Request, Response } from 'express';

import { AuditWriteError, gatewayActionType, type AuditClient } from './client.ts';
import { GatewayError, type AccessResult } from '../types.ts';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function shouldAudit(level: 'none' | 'writes' | 'all', method: string): boolean {
  if (level === 'none') return false;
  if (level === 'all') return true;
  return WRITE_METHODS.has(method.toUpperCase());
}

/**
 * Re-exported from packages/audit-client rather than reimplemented.
 *
 * scripts/db/migrate.mjs derives the REGISTERED event types from the same rule. Two
 * copies would let the registry and the emitter disagree, and the failure mode is a
 * foreign key violation that takes the request down with it.
 */
export const actionTypeFor = gatewayActionType;

export function auditAccess(client: AuditClient) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const { group, session, decision, requestId } = req.ctx;

    if (group === undefined || !shouldAudit(group.audit, req.method)) {
      next();
      return;
    }

    // Guaranteed by the boot cross-check: an audited group always declares a
    // registered purpose, because audit_events.purpose is NOT NULL.
    const purpose = group.purpose;
    if (purpose === undefined) {
      next(new GatewayError(500, 'audit_without_purpose', 'Internal error.'));
      return;
    }

    try {
      await client.write({
        requestId,
        pseudoId: session?.pseudoId,
        actorId: session?.sessionId,
        actorRole: session?.actorRole ?? 'system',
        serviceName: 'gateway',
        actionType: actionTypeFor(group.prefix, req.method),
        purpose,
        consentDecision: decision?.consent ?? 'not_required',
        accessResult: (decision?.result ?? 'allowed') satisfies AccessResult,
        context: {
          api_group: group.prefix,
          method: req.method,
          upstream_service: group.service,
          step_up_required: group.stepUp,
        },
      });
    } catch (cause) {
      if (cause instanceof AuditWriteError) {
        next(
          new GatewayError(
            503,
            'audit_unavailable',
            'Service temporarily unavailable.',
            'refusing to proceed with an unlogged sensitive access',
          ),
        );
        return;
      }
      next(cause as Error);
      return;
    }

    req.ctx.audited = true;
    next();
  };
}

/**
 * Statuses that mean "the gateway refused this", as opposed to "the gateway allowed
 * it and something downstream broke".
 *
 * Only the first kind is a denial worth recording as one. A 502 from an unreachable
 * upstream, or a 504 from a slow one, says nothing about whether access was
 * permitted — the gateway already decided that, and stage 8 already recorded it.
 */
const POLICY_DENIAL_STATUSES = new Set([400, 401, 403, 404, 429]);

export function isPolicyDenial(status: number): boolean {
  return POLICY_DENIAL_STATUSES.has(status);
}

/**
 * Records a denial that a policy stage produced, then lets the error handler
 * respond. Mounted as error middleware so it sees GatewayErrors from every stage.
 *
 * EXACTLY ONE AUDIT ROW PER REQUEST. If stage 8 already wrote the access decision,
 * this writes nothing: the request was allowed by the gateway, and a later failure
 * downstream does not retroactively make it a denial. Writing both produced rows
 * claiming `consent_decision: denied` for requests where consent was never the
 * problem, and an audit vault is the one place an untrue row cannot be corrected.
 */
export function auditDenial(client: AuditClient) {
  return async (
    err: unknown,
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const { group, session, requestId, audited } = req.ctx ?? {};

    if (
      group === undefined ||
      group.audit === 'none' ||
      !(err instanceof GatewayError) ||
      group.purpose === undefined ||
      // Already recorded upstream of this handler.
      audited === true ||
      // Infrastructure failure, not a policy decision.
      !isPolicyDenial(err.status)
    ) {
      next(err);
      return;
    }

    // Best effort. The request is already failing; a failed denial-audit must not
    // replace a 403 the caller needs to see with a confusing 503.
    try {
      await client.write({
        requestId: requestId ?? '00000000-0000-0000-0000-000000000000',
        pseudoId: session?.pseudoId,
        actorId: session?.sessionId,
        actorRole: session?.actorRole ?? 'system',
        serviceName: 'gateway',
        actionType: actionTypeFor(group.prefix, req.method),
        purpose: group.purpose,
        consentDecision: 'denied',
        accessResult: 'denied',
        context: {
          api_group: group.prefix,
          method: req.method,
          denial_reason: err.code,
          status: err.status,
        },
      });
    } catch (writeFailure) {
      req.log?.error({ err: writeFailure }, 'failed to audit a denial');
    }

    next(err);
  };
}
