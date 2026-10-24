/**
 * Stage 9 — service authorization and forwarding.
 *
 * The gateway is the only thing permitted to set `x-alaap-*`, and downstream
 * services trust those headers to carry the caller's identity. That trust is what
 * the HMAC signature below establishes: a service receiving a request can verify it
 * came from the gateway and that the identity headers were not altered in transit.
 *
 * MVP mechanism. mTLS between deployables replaces it before production — in
 * particular before `identity-isolate` carries real records, since a shared secret
 * distributed to fifteen services is a weaker boundary than the network segment it
 * is meant to protect. To be recorded as an ADR.
 *
 * Note what is NOT forwarded: no legal name, no plan tier, no consent grant. The
 * downstream service resolves those itself, from the vault it owns, under its own
 * record-level check (backend-requirements §9).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { minimiseResponse } from '../minimisation/index.ts';
import { GatewayError, type ApiGroup, type RequestContext } from '../types.ts';
import type { SessionStore } from '../infrastructure/session-store.ts';
import { applySessionCookie } from './session-cookie.ts';
import { applyStepUp } from './step-up.ts';

export interface ServiceAuthHeaders {
  'x-alaap-request-id': string;
  'x-alaap-actor-role': string;
  'x-alaap-purpose': string;
  'x-alaap-issued-at': string;
  'x-alaap-pseudo-id'?: string;
  'x-alaap-session-id'?: string;
  'x-alaap-stepped-up-scope'?: string;
  /**
   * The trusted device this session was created on, when it has one.
   *
   * Carried so a service can say "this device" in a list, and so "sign out everywhere
   * else" knows which one to keep. Signed like the rest: a client that could set it
   * would be able to spare its own session from exactly that action.
   */
  'x-alaap-device-id'?: string;
}

/**
 * Signs the identity headers, not the body.
 *
 * The body is the caller's and the downstream service validates it independently.
 * What needs integrity protection is the gateway's assertion about *who* is calling,
 * which is exactly the header set below. Signing in sorted order so the
 * reconstruction on the receiving side is unambiguous.
 */
export function signHeaders(headers: ServiceAuthHeaders, secret: string): string {
  const canonical = Object.entries(headers)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join('\n');
  return createHmac('sha256', secret).update(canonical, 'utf8').digest('base64url');
}

/** Provided for the service-side middleware that will verify these. */
export function verifyHeaders(
  headers: ServiceAuthHeaders,
  signature: string,
  secret: string,
): boolean {
  const expected = Buffer.from(signHeaders(headers, secret), 'utf8');
  const actual = Buffer.from(signature, 'utf8');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

function buildHeaders(ctx: RequestContext, secret: string): Record<string, string> {
  const group = ctx.group;
  const headers: ServiceAuthHeaders = {
    'x-alaap-request-id': ctx.requestId,
    'x-alaap-actor-role': ctx.session?.actorRole ?? 'anonymous',
    'x-alaap-purpose': group?.purpose ?? 'none',
    'x-alaap-issued-at': new Date().toISOString(),
  };

  if (ctx.session !== undefined) {
    headers['x-alaap-pseudo-id'] = String(ctx.session.pseudoId);
    headers['x-alaap-session-id'] = ctx.session.sessionId;
    if (ctx.session.steppedUpScope !== undefined) {
      headers['x-alaap-stepped-up-scope'] = ctx.session.steppedUpScope;
    }
    if (ctx.session.deviceId !== undefined) {
      headers['x-alaap-device-id'] = ctx.session.deviceId;
    }
  }

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) out[k] = v;
  }
  out['x-alaap-service-auth'] = signHeaders(headers, secret);
  return out;
}

/** Hop-by-hop headers and anything the upstream must not inherit from the client. */
const STRIP_FROM_CLIENT = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'te',
  'trailer',
  // The session token stops here. A downstream service has no use for it and must
  // not be able to replay it against the gateway.
  'authorization',
  'cookie',
  'content-length',
]);

export interface ProxyOptions {
  serviceAuthSecret: string;
  upstreamFor(serviceId: string): string | undefined;
  timeoutMs?: number;
  /** How long the browser's session cookie lives. Matches the session's own ceiling. */
  sessionMaxAbsoluteHours?: number;
  /** Needed to amend a session when a step-up is verified. */
  sessions?: SessionStore;
  /** The route policy, so a granted scope can be checked against it. */
  groups?: readonly ApiGroup[];
}

export function proxy(options: ProxyOptions) {
  const timeoutMs = options.timeoutMs ?? 15_000;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const group = req.ctx.group;
    if (group === undefined) {
      next(new GatewayError(500, 'pipeline_order', 'Internal error.', 'proxy before route'));
      return;
    }

    const base = options.upstreamFor(group.service);
    if (base === undefined) {
      // Expected while the domain services are unbuilt. A clean 502 beats a hang.
      next(
        new GatewayError(
          502,
          'upstream_not_configured',
          'This feature is not available yet.',
          `no upstream configured for ${group.service}`,
        ),
      );
      return;
    }

    const target = new URL(req.originalUrl, base);

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (STRIP_FROM_CLIENT.has(name.toLowerCase())) continue;
      if (name.toLowerCase().startsWith('x-alaap-')) continue; // belt and braces
      if (typeof value === 'string') headers[name] = value;
      else if (Array.isArray(value)) headers[name] = value.join(', ');
    }
    Object.assign(headers, buildHeaders(req.ctx, options.serviceAuthSecret));

    const hasBody = !['GET', 'HEAD'].includes(req.method.toUpperCase());
    let body: string | undefined;
    if (hasBody && req.body !== undefined && req.body !== null) {
      body = JSON.stringify(req.body);
      headers['content-type'] = 'application/json';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal: controller.signal,
        redirect: 'manual',
      });

      const raw = Buffer.from(await upstream.arrayBuffer());
      const minimised = minimiseResponse(group.prefix, raw);

      res.status(upstream.status);
      upstream.headers.forEach((value, name) => {
        const lower = name.toLowerCase();
        if (lower === 'content-length' || lower === 'transfer-encoding') return;
        // A downstream service must not be able to set a cookie on our origin.
        if (lower === 'set-cookie') return;
        res.setHeader(name, value);
      });
      res.setHeader('x-request-id', req.ctx.requestId);

      // The only place a browser credential is issued. Restricted to groups that
      // declare they mint sessions, so no other route can hand one out by accident.
      // A verified second factor, stamped onto the session. Restricted to the one
      // group that actually checks a code, so no other route can assert presence.
      if (group.stepUpGrant && options.sessions !== undefined && options.groups !== undefined) {
        const scope = await applyStepUp(
          req,
          options.sessions,
          options.groups,
          upstream.status,
          minimised,
        );
        if (scope !== undefined) req.log?.info({ scope }, 'step-up granted');
      }

      if (group.sessionCookie) {
        applySessionCookie(
          req,
          res,
          upstream.status,
          minimised,
          (options.sessionMaxAbsoluteHours ?? 720) * 3600,
        );
      }

      res.send(minimised);
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      next(
        new GatewayError(
          aborted ? 504 : 502,
          aborted ? 'upstream_timeout' : 'upstream_unreachable',
          'Service temporarily unavailable.',
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
    } finally {
      clearTimeout(timer);
    }
  };
}
