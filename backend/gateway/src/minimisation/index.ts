/**
 * Stage 7 — data minimisation.
 *
 * Strips fields a caller must never be able to set, on the way in. These are the
 * fields a downstream service would otherwise have to distrust individually, and the
 * point of a single entry point is that it does not have to.
 *
 * WHAT THIS DOES NOT YET DO
 *
 * Response-side minimisation — trimming a downstream response to the fields this
 * route is permitted to return — needs per-route response schemas, which live in
 * metadata/api/openapi/ and are not written yet. Until they are, a service that
 * over-returns will over-return through the gateway. That is a real gap and it is
 * recorded here rather than papered over: the owning service is currently the only
 * thing standing between a caller and a field it should not see.
 *
 * The seam is `minimiseResponse` below, which is wired into the proxy and currently
 * passes bodies through untouched.
 */

import type { NextFunction, Request, Response } from 'express';

/**
 * Fields that identify or authorise, and therefore may only ever be set by the
 * gateway from a validated session — never accepted from a caller.
 */
const FORBIDDEN_INBOUND = new Set([
  'pseudo_id',
  'pseudoId',
  'account_id',
  'accountId',
  'actor_role',
  'actorRole',
  'session_id',
  'sessionId',
  'purpose',
  'consent_decision',
  'consentDecision',
  'plan',
  'plan_tier',
  'planTier',
  'subsidy_source',
  'subsidySource',
  'is_admin',
  'isAdmin',
  'stepped_up_at',
  'steppedUpAt',
]);

function stripForbidden(value: unknown, stripped: string[], depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((v) => stripForbidden(v, stripped, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_INBOUND.has(key)) {
      stripped.push(key);
      continue;
    }
    out[key] = stripForbidden(v, stripped, depth + 1);
  }
  return out;
}

export function minimiseRequest() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const stripped: string[] = [];

    if (typeof req.body === 'object' && req.body !== null) {
      req.body = stripForbidden(req.body, stripped);
    }

    for (const key of Object.keys(req.query)) {
      if (FORBIDDEN_INBOUND.has(key)) {
        stripped.push(key);
        delete (req.query as Record<string, unknown>)[key];
      }
    }

    if (stripped.length > 0) {
      // Field names only — never values. A caller sending these is either a stale
      // client or someone probing, and both are worth seeing in the logs.
      req.log?.warn({ stripped }, 'stripped caller-supplied privileged fields');
    }

    next();
  };
}

/**
 * Response-side seam. Wired but inert until metadata/api/openapi/ defines per-route
 * response shapes. See the note at the top of this file.
 */
export function minimiseResponse(_group: string, body: Buffer): Buffer {
  return body;
}
