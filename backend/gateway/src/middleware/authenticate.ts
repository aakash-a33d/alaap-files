/**
 * Stages 1 and 2 — authentication and session validation.
 *
 * Authentication here means "present a token"; validation means "the token resolves
 * to a live, unrevoked, unexpired session". They are one middleware because the
 * gateway has no way to do the first without the second — the token is opaque and
 * carries no claims of its own, which is the point of choosing opaque tokens over
 * JWTs (backend-requirements §5).
 */

import type { NextFunction, Request, Response } from 'express';

import type { SessionStore } from '../infrastructure/session-store.ts';
import { GatewayError } from '../types.ts';

const BEARER = /^Bearer\s+(.+)$/i;

function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === 'string') {
    const match = BEARER.exec(header);
    if (match?.[1] !== undefined) return match[1].trim();
  }
  // Cookie fallback for the browser client. The cookie is HttpOnly, Secure and
  // SameSite=Lax; it carries the same opaque token, not a separate credential.
  const cookie = req.headers.cookie;
  if (typeof cookie === 'string') {
    for (const part of cookie.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === 'alaap_session' && rest.length > 0) return rest.join('=');
    }
  }
  return undefined;
}

export function authenticate(sessions: SessionStore) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const group = req.ctx.group;
    if (group === undefined) {
      next(new GatewayError(500, 'pipeline_order', 'Internal error.', 'authenticate before route'));
      return;
    }

    const token = extractToken(req);

    if (group.authentication === 'none') {
      // Unauthenticated groups exist so a session can be created. A token presented
      // here is ignored rather than validated: /api/auth must behave identically for
      // a caller holding a stale token and one holding none.
      next();
      return;
    }

    if (token === undefined) {
      next(new GatewayError(401, 'no_session', 'Sign in to continue.'));
      return;
    }

    let lookup;
    try {
      lookup = await sessions.resolve(token);
    } catch (cause) {
      // Redis is down. Fail closed: an unverifiable session is not a valid one.
      next(
        new GatewayError(
          503,
          'session_store_unavailable',
          'Service temporarily unavailable.',
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
      return;
    }

    if (lookup === undefined) {
      // Absent, malformed, revoked and expired are all this response. The caller
      // must not be able to tell which.
      next(new GatewayError(401, 'no_session', 'Sign in to continue.'));
      return;
    }

    req.ctx.session = lookup.record;
    req.ctx.sessionToken = token;
    next();
  };
}
