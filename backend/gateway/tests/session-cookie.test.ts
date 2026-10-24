/**
 * The browser's credential.
 *
 * The rule these defend is that a session token must never be readable by JavaScript.
 * An opaque token is not a claim about who somebody is, it IS the session — so an XSS
 * that can read it holds the account, and on this platform that is a clinical vault.
 *
 * Most of what can go wrong here is silent. A cookie missing HttpOnly still works. A
 * cookie cleared with different attributes than it was set with still returns 200, and
 * leaves the session live in the browser. Neither shows up in a flow test.
 */

import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';

import {
  applySessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
} from '../src/routes/session-cookie.ts';
import { loadMetadata } from '../src/config/metadata.ts';

function fakeReq(over: Partial<Request> = {}): Request {
  return { protocol: 'http', headers: {}, ...over } as Request;
}

function fakeRes(): Response & { headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  } as never;
}

const HOUR = 3600;
const body = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8');

describe('issuing', () => {
  it('sets the cookie when a response carries a token', () => {
    const res = fakeRes();
    applySessionCookie(fakeReq(), res, 201, body({ token: 'alaap_abc' }), HOUR);

    const cookie = res.headers['Set-Cookie']!;
    expect(cookie).toContain(`${SESSION_COOKIE}=alaap_abc`);
  });

  it('marks it HttpOnly, so no script can read it', () => {
    const res = fakeRes();
    applySessionCookie(fakeReq(), res, 201, body({ token: 'alaap_abc' }), HOUR);

    expect(res.headers['Set-Cookie']).toContain('HttpOnly');
  });

  it('uses SameSite=Lax, so following a link in does not sign you out', () => {
    // Strict drops the cookie on any cross-site navigation, including a member
    // following a link from their own recovery email into the app.
    const res = fakeRes();
    applySessionCookie(fakeReq(), res, 201, body({ token: 'alaap_abc' }), HOUR);

    expect(res.headers['Set-Cookie']).toContain('SameSite=Lax');
  });

  it('leaves Secure off over http and adds it over https', () => {
    // Derived, not hard-coded. Unconditional Secure breaks local development, and the
    // fix people reach for is removing the flag everywhere.
    const plain = fakeRes();
    applySessionCookie(fakeReq(), plain, 201, body({ token: 't' }), HOUR);
    expect(plain.headers['Set-Cookie']).not.toContain('Secure');

    const tls = fakeRes();
    applySessionCookie(fakeReq({ protocol: 'https' }), tls, 201, body({ token: 't' }), HOUR);
    expect(tls.headers['Set-Cookie']).toContain('Secure');
  });

  it('honours x-forwarded-proto, for a TLS-terminating proxy in front', () => {
    const res = fakeRes();
    applySessionCookie(
      fakeReq({ headers: { 'x-forwarded-proto': 'https,http' } as never }),
      res,
      201,
      body({ token: 't' }),
      HOUR,
    );
    expect(res.headers['Set-Cookie']).toContain('Secure');
  });
});

describe('not issuing', () => {
  it('ignores a response with no token — register/start returns a challenge', () => {
    // /api/auth carries routes that mint nothing. Keying on the body rather than the
    // path is what keeps this correct as auth-service grows routes.
    const res = fakeRes();
    applySessionCookie(fakeReq(), res, 200, body({ challengeId: 'c1', devCode: '123456' }), HOUR);

    expect(res.headers['Set-Cookie']).toBeUndefined();
  });

  it('ignores a failed response that happens to echo a token', () => {
    const res = fakeRes();
    applySessionCookie(fakeReq(), res, 401, body({ token: 'alaap_abc' }), HOUR);

    expect(res.headers['Set-Cookie']).toBeUndefined();
  });

  it('ignores a non-JSON body without throwing', () => {
    const res = fakeRes();
    expect(() =>
      applySessionCookie(fakeReq(), res, 200, Buffer.from('<html>not json', 'utf8'), HOUR),
    ).not.toThrow();
    expect(res.headers['Set-Cookie']).toBeUndefined();
  });

  it('ignores a non-string token', () => {
    const res = fakeRes();
    applySessionCookie(fakeReq(), res, 200, body({ token: { nested: 'object' } }), HOUR);

    expect(res.headers['Set-Cookie']).toBeUndefined();
  });
});

describe('clearing', () => {
  it('clears on revoked: true', () => {
    const res = fakeRes();
    applySessionCookie(fakeReq(), res, 200, body({ revoked: true }), HOUR);

    expect(res.headers['Set-Cookie']).toContain('Max-Age=0');
  });

  it('clears with the SAME attributes it was set with', () => {
    // A Set-Cookie whose Path or SameSite disagrees with the original does not replace
    // it — the browser keeps both and the session stays live. This is the failure that
    // returns 200 and looks exactly like success.
    const set = fakeRes();
    applySessionCookie(fakeReq(), set, 201, body({ token: 'alaap_abc' }), HOUR);

    const cleared = fakeRes();
    clearSessionCookie(fakeReq(), cleared);

    const attrs = (c: string) =>
      c
        .split(';')
        .slice(1)
        .map((p) => p.trim())
        .filter((p) => !p.startsWith('Max-Age='));

    expect(attrs(cleared.headers['Set-Cookie']!)).toEqual(attrs(set.headers['Set-Cookie']!));
  });
});

describe('which groups may issue one', () => {
  it('is only the group that mints sessions', () => {
    // The proxy consults this flag before calling applySessionCookie. If a second group
    // ever sets it, that is a decision someone must make deliberately — a route that
    // can hand out a browser credential is a route that can hand out an account.
    const minting = loadMetadata().groups.filter((g) => g.sessionCookie);

    expect(minting.map((g) => g.prefix)).toEqual(['/api/auth']);
  });
});
