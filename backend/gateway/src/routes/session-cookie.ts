/**
 * Turning a minted session into a browser credential.
 *
 * The proxy strips `set-cookie` from every upstream response, on purpose: a downstream
 * service must not be able to set a cookie on the gateway's origin. That rule leaves
 * exactly one place a browser credential can come from, which is here.
 *
 * WHY A COOKIE AND NOT THE TOKEN
 *
 * The token is opaque — it carries no claims, and validating it means looking it up.
 * That is the point (backend-requirements §5), and it also means the token is not a
 * statement about who somebody is, it IS the session. Anything that can read it holds
 * the account until the session is revoked.
 *
 * A browser can only keep a readable token somewhere JavaScript can reach, so any XSS
 * on any page — an injected dependency, a bad piece of markdown, a third-party script
 * nobody audited — exfiltrates a live session. On this platform that is somebody's
 * journal and their clinical vault. HttpOnly removes the whole class: the credential is
 * attached by the browser and never exists as a value the page can read.
 *
 * The response body keeps the token. The dev scripts sign with it, and a native client
 * has no cookie jar to rely on. What changes is that the browser stops needing it.
 */

import type { Request, Response } from 'express';

/** The cookie the gateway's authenticate middleware already looks for. */
export const SESSION_COOKIE = 'alaap_session';

/**
 * Was this request made over TLS?
 *
 * `Secure` is set from the request rather than unconditionally. A cookie marked Secure
 * is simply not sent over http, so hard-coding it breaks local development — and the
 * fix someone reaches for at 1am is to remove the flag everywhere, which is how it ends
 * up missing in production. Deriving it means it is right in both places without anyone
 * choosing.
 */
function isSecure(req: Request): boolean {
  if (req.protocol === 'https') return true;
  const forwarded = req.headers['x-forwarded-proto'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return typeof first === 'string' && first.split(',')[0]?.trim() === 'https';
}

function serialise(req: Request, value: string, maxAgeSeconds: number): string {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    // Lax, not Strict. Strict would drop the cookie when a member follows a link into
    // the app from anywhere else — including the link in their own recovery email —
    // and land them on a signed-out screen they have no way to understand.
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecure(req)) parts.push('Secure');
  return parts.join('; ');
}

/** Clear it. Max-Age=0 tells the browser to drop it now. */
export function clearSessionCookie(req: Request, res: Response): void {
  res.setHeader('Set-Cookie', serialise(req, '', 0));
}

/**
 * Issue or clear the cookie based on what the upstream just did.
 *
 * Called only for groups declaring `session_cookie: true`. Reads the response body the
 * proxy is about to send rather than trusting the route name: `/api/auth` also carries
 * `register/start`, which returns a challenge and no session, and a rule keyed on the
 * path would have to be kept in step with auth-service's routes forever.
 *
 * `revoked: true` in the body is how logout says so. The cookie is cleared on the way
 * out regardless of whether the server-side revocation succeeded — a browser still
 * holding a credential the member asked us to destroy is the worse failure.
 */
export function applySessionCookie(
  req: Request,
  res: Response,
  status: number,
  body: Buffer,
  maxAgeSeconds: number,
): void {
  if (status < 200 || status >= 300) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    return; // not JSON; nothing minted a session
  }
  if (typeof parsed !== 'object' || parsed === null) return;

  const shape = parsed as { token?: unknown; revoked?: unknown };

  if (shape.revoked === true) {
    clearSessionCookie(req, res);
    return;
  }

  if (typeof shape.token === 'string' && shape.token.length > 0) {
    res.setHeader('Set-Cookie', serialise(req, shape.token, maxAgeSeconds));
  }
}
