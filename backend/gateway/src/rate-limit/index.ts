/**
 * Stage 6 — rate limiting.
 *
 * THIS IS ANTI-ABUSE, NOT PLAN QUOTA. The two are different questions and live in
 * different places:
 *
 *   rate limit   "is this caller hammering us" — short window, per session or IP
 *                prefix, enforced here because it protects the whole platform
 *
 *   plan quota   "has this member used their four posts this month" — an
 *                ENTITLEMENT decision, enforced by community-service from
 *                metadata/catalog/plans/. The gateway holds no billing credentials
 *                and cannot read a plan tier, so it could not make this call even
 *                if it were the right place for it.
 *
 * Conflating them would put an entitlement decision in a service with no billing
 * access, and would make a quota exhaustion look like an abuse signal in the logs.
 *
 * Fixed window, not sliding. A caller can burst across a window boundary, which is
 * acceptable for abuse protection and buys a great deal of simplicity. If a route
 * ever needs a strict bound, it gets a token bucket rather than this being made
 * cleverer for everyone.
 */

import type { NextFunction, Request, Response } from 'express';
import type { Redis } from 'ioredis';

import { GatewayError } from '../types.ts';

export interface RateLimitConfig {
  windowSeconds: number;
  maxAuthenticated: number;
  maxAnonymous: number;
}

export function rateLimit(redis: Redis, config: RateLimitConfig) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { session, ipPrefix, group } = req.ctx;

    // Authenticated callers are limited per session, so one member on a shared
    // college NAT cannot exhaust the allowance for everyone behind it.
    const scope = session !== undefined ? 'session' : 'ip';
    const subject = session !== undefined ? session.sessionId : (ipPrefix ?? 'unknown');
    const max = session !== undefined ? config.maxAuthenticated : config.maxAnonymous;

    const window = Math.floor(Date.now() / (config.windowSeconds * 1000));
    const key = `ratelimit:${scope}:${subject}:${group?.prefix ?? 'unrouted'}:${window}`;

    let count: number;
    try {
      const pipeline = redis.multi();
      pipeline.incr(key);
      pipeline.expire(key, config.windowSeconds + 1);
      const results = await pipeline.exec();
      count = Number(results?.[0]?.[1] ?? 0);
    } catch (cause) {
      // Redis is down. Fail OPEN here, unlike session lookup.
      //
      // The asymmetry is deliberate: an unverifiable session is a security
      // question and must fail closed, but an uncountable request is a capacity
      // question. Rejecting every request because the rate limiter is unavailable
      // converts a Redis blip into a total outage, and the session store above has
      // already failed the request closed if authentication mattered.
      req.log?.warn({ err: cause }, 'rate limiter unavailable, allowing');
      next();
      return;
    }

    const remaining = Math.max(0, max - count);
    res.setHeader('ratelimit-limit', String(max));
    res.setHeader('ratelimit-remaining', String(remaining));
    res.setHeader('ratelimit-reset', String((window + 1) * config.windowSeconds));

    if (count > max) {
      res.setHeader('retry-after', String(config.windowSeconds));
      next(
        new GatewayError(
          429,
          'rate_limited',
          'Too many requests. Please wait a moment.',
          `${scope} exceeded ${max} in ${config.windowSeconds}s`,
        ),
      );
      return;
    }

    next();
  };
}
