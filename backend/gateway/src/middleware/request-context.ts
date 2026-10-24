/**
 * Stage 0 — request context.
 *
 * Establishes the request id that every later stage, every audit row and every
 * downstream service correlates on, and strips the trust headers.
 *
 * THE HEADER STRIP IS THE IMPORTANT PART. Downstream services trust `x-alaap-*`
 * headers to carry the caller's identity, because the gateway is the only thing
 * permitted to set them. If a client could send its own `x-alaap-pseudo-id`, it
 * would be able to act as any member on the platform. Everything else in this
 * gateway is defence in depth; this is the load-bearing line.
 */

import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import type { RequestContext } from '../types.ts';

export const TRUSTED_HEADER_PREFIX = 'x-alaap-';

/**
 * Truncate to a /24 (IPv4) or /48 (IPv6) prefix.
 *
 * Used for anti-abuse rate limiting on unauthenticated routes. Full addresses are
 * never retained — §12N keeps IP retention short and coarse, and the same treatment
 * is applied to `login_events.ip_prefix`.
 */
export function truncateIp(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  const address = raw.split(',')[0]?.trim();
  if (address === undefined || address === '') return undefined;

  if (address.includes(':')) {
    const groups = address.split(':').filter((g) => g !== '');
    return groups.slice(0, 3).join(':') + '::/48';
  }

  const octets = address.split('.');
  if (octets.length !== 4) return undefined;
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
}

export function requestContext() {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const name of Object.keys(req.headers)) {
      if (name.toLowerCase().startsWith(TRUSTED_HEADER_PREFIX)) {
        delete req.headers[name];
      }
    }

    const ctx: RequestContext = {
      requestId: randomUUID(),
      startedAt: Date.now(),
    };

    const ip = truncateIp(req.socket.remoteAddress ?? undefined);
    if (ip !== undefined) ctx.ipPrefix = ip;

    req.ctx = ctx;
    res.setHeader('x-request-id', ctx.requestId);
    next();
  };
}
