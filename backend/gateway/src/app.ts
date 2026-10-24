/**
 * The Privacy Gateway pipeline.
 *
 * backend/README.md fixes this order:
 *
 *   authentication, session validation, role check, consent check,
 *   purpose limitation, rate limit, data minimisation, service authorization,
 *   audit event
 *
 * The order is not stylistic. Each stage depends on what the one before established:
 * the role check needs a session, the consent check needs a purpose the route
 * resolved, the rate limiter prefers a session id over an IP prefix, and the audit
 * event needs the decision every earlier stage contributed to.
 *
 * Two deviations from a naive reading of that list, both deliberate:
 *
 *   - Route resolution runs first. Nothing above can be evaluated without knowing
 *     which policy applies, and a path with no policy is refused rather than
 *     defaulted (absence is denial).
 *
 *   - The audit event is written BEFORE the proxy, not after the response. See the
 *     header comment in audit/middleware.ts — it is the only arrangement in which
 *     "a failed audit write fails the operation it was recording" can hold.
 *
 * tests/pipeline-order.test.ts asserts this sequence so a future refactor cannot
 * quietly reorder it.
 */

import express, { type Express } from 'express';
import type { Redis } from 'ioredis';

import type { AuditClient } from './audit/client.ts';
import { auditAccess, auditDenial } from './audit/middleware.ts';
import type { Env } from './config/env.ts';
import { upstreamFor } from './config/env.ts';
import type { GatewayMetadata } from './config/metadata.ts';
import type { SessionStore } from './infrastructure/session-store.ts';
import type { Logger } from './log.ts';
import { authenticate } from './middleware/authenticate.ts';
import { errorHandler, notFound } from './middleware/error.ts';
import { requestContext } from './middleware/request-context.ts';
import { minimiseRequest } from './minimisation/index.ts';
import { consentCheck } from './policies/consent/index.ts';
import { purposeLimitation } from './policies/purpose/index.ts';
import { roleCheck } from './policies/rbac/index.ts';
import { rateLimit } from './rate-limit/index.ts';
import { logoutRoute } from './routes/logout.ts';
import { proxy } from './routes/proxy.ts';
import { resolveRoute, RouteTable } from './routes/table.ts';

export interface GatewayDeps {
  env: Env;
  metadata: GatewayMetadata;
  redis: Redis;
  sessions: SessionStore;
  audit: AuditClient;
  logger: Logger;
}

export function createApp(deps: GatewayDeps): Express {
  const { env, metadata, redis, sessions, audit, logger } = deps;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);

  // Liveness only. No dependency checks, no version, no build info — a probe
  // endpoint is the most-scanned path on any deployment and it should say nothing.
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use(express.json({ limit: '256kb' }));

  // ---- 0 · context, and the trust-header strip ---------------------------
  app.use(requestContext());
  app.use((req, _res, next) => {
    req.log = logger.child({ requestId: req.ctx.requestId });
    next();
  });

  // ---- 0b · sign out ------------------------------------------------------
  //
  // Answered here, ahead of the pipeline, and deliberately. Signing out has to work
  // from a broken state — an expired session, a revoked one, a rate-limited caller, a
  // role that no longer reaches anything — and every one of those fails somewhere in
  // stages 1-8 and would leave the member still holding a cookie. There is nothing to
  // authorise: revoking your own token requires holding your own token.
  logoutRoute(app, sessions, logger);

  // ---- 0c · route policy -------------------------------------------------
  app.use('/api', resolveRoute(new RouteTable(metadata.groups)));

  // ---- 1,2 · authentication and session validation -----------------------
  app.use('/api', authenticate(sessions));

  // ---- 3 · role check, and step-up where the group demands it ------------
  app.use('/api', roleCheck());

  // ---- 4 · coarse consent ------------------------------------------------
  app.use('/api', consentCheck(metadata.purposes));

  // ---- 5 · purpose limitation --------------------------------------------
  app.use('/api', purposeLimitation(metadata.purposes));

  // ---- 6 · rate limit (anti-abuse; plan quota is community-service) ------
  app.use(
    '/api',
    rateLimit(redis, {
      windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
      maxAuthenticated: env.RATE_LIMIT_MAX_AUTHENTICATED,
      maxAnonymous: env.RATE_LIMIT_MAX_ANONYMOUS,
    }),
  );

  // ---- 7 · data minimisation ---------------------------------------------
  app.use('/api', minimiseRequest());

  // ---- 8 · audit the access decision, before anything is forwarded -------
  app.use('/api', auditAccess(audit));

  // ---- 9 · service authorization and forward -----------------------------
  app.use(
    '/api',
    proxy({
      serviceAuthSecret: env.SERVICE_AUTH_SECRET,
      upstreamFor: (serviceId) => upstreamFor(env, serviceId),
      sessionMaxAbsoluteHours: env.SESSION_MAX_ABSOLUTE_HOURS,
      sessions,
      groups: metadata.groups,
    }),
  );

  app.use(notFound());
  app.use(auditDenial(audit));
  app.use(errorHandler());

  return app;
}
