/**
 * Sign out.
 *
 * The only route the gateway answers itself rather than forwarding, and it has to be,
 * because of a rule the proxy enforces one file over: `authorization` and `cookie` are
 * stripped before anything is forwarded, so the session token never reaches a
 * downstream service. auth-service therefore cannot revoke the session it minted — it
 * has no way to learn which one is being used. The gateway holds the token, the cookie
 * and the session store, so it is the only component that can end a session.
 *
 * WHY THIS RUNS BEFORE THE PIPELINE
 *
 * Signing out must work from a broken state. A session that is expired, revoked,
 * rate-limited, or attached to a role that no longer reaches anything still leaves a
 * cookie in somebody's browser, and every one of those would fail somewhere in stages
 * 1-8 and leave them holding it. A member who presses "sign out" gets a signed-out
 * browser, always. There is nothing to authorise: revoking your own token requires
 * holding your own token.
 *
 * It answers 200 whether or not the token resolved to anything. A caller cannot tell
 * whether their session was already dead, which is the same reason `withdraw` in
 * consent-service refuses to distinguish — and there is no useful way to act on the
 * difference anyway.
 */

import type { Express, Request, Response } from 'express';

import type { SessionStore } from '../infrastructure/session-store.ts';
import { clearSessionCookie, SESSION_COOKIE } from './session-cookie.ts';

const BEARER = /^Bearer\s+(.+)$/i;

/** The same two places `authenticate` looks, for the same reasons. */
function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === 'string') {
    const match = BEARER.exec(header);
    if (match?.[1] !== undefined) return match[1].trim();
  }
  const cookie = req.headers.cookie;
  if (typeof cookie === 'string') {
    for (const part of cookie.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === SESSION_COOKIE && rest.length > 0) return rest.join('=');
    }
  }
  return undefined;
}

export function logoutRoute(
  app: Express,
  sessions: SessionStore,
  log: { error(o: object, m?: string): void },
): void {
  app.post('/api/auth/logout', async (req: Request, res: Response) => {
    const token = extractToken(req);

    if (token !== undefined) {
      try {
        await sessions.revoke(token);
      } catch (err) {
        // The cookie is still cleared. A browser holding a credential the member asked
        // us to destroy is worse than a session row that outlives its cookie, and the
        // session has a hard expiry regardless.
        log.error(
          { err: err instanceof Error ? err.message : String(err) },
          'session revocation failed; clearing the cookie anyway',
        );
      }
    }

    // This route answers directly rather than through the proxy, so it clears the
    // cookie itself — using the same serialiser, so the attributes cannot drift from
    // the ones it was set with. A Set-Cookie whose Path or SameSite disagrees with the
    // original does not replace it; it sits beside it and the session stays live.
    clearSessionCookie(req, res);
    res.status(200).json({ revoked: true });
  });
}
