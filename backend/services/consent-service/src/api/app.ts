/**
 * HTTP surface for consent.
 *
 * `/api/consent` is the member's: what they have agreed to, and the ability to stop.
 * `/internal/consent/check` is clinical-vault-service asking whether it may proceed,
 * and has no gateway route — a member who could answer that question for themselves
 * would be granting their own permission.
 */

import { randomUUID } from 'node:crypto';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { verifyRequest, type VerifiedCaller } from '@alaap/service-auth';
import { z } from 'zod';

import type { Consent } from '../application/consent.ts';
import type { ConsentRepository } from '../infrastructure/consent.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      caller?: VerifiedCaller;
    }
  }
}

export interface AppDeps {
  consent: Consent;
  /** Export and purge for this vault. Reached only by retention-service. */
  repo: ConsentRepository;
  serviceAuthSecret: string;
  log: {
    info(o: object, m?: string): void;
    warn(o: object, m?: string): void;
    error(o: object, m?: string): void;
  };
}

function requireGateway(secret: string, log: AppDeps['log']) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const outcome = verifyRequest(req.headers, secret);
    if (!outcome.ok) {
      log.warn({ reason: outcome.reason, path: req.path }, 'rejected unsigned request');
      res.status(401).json({ error: { code: 'service_auth_required' } });
      return;
    }
    req.caller = outcome.caller;
    next();
  };
}

/**
 * The purpose travels in the PATH, not the body.
 *
 * The gateway refuses any request whose body or query carries a `purpose` field — a
 * caller that could declare its own purpose would defeat purpose limitation entirely,
 * so the middleware treats it as smuggling and returns 400.
 *
 * Consent is the one place where a purpose is legitimately the caller's subject rather
 * than its claim: "I agree to care-delivery" is a statement about what is being
 * consented to, not about why this request is being made. Putting it in the path keeps
 * that distinction, and keeps the gateway's rule absolute rather than carved out.
 */
const PURPOSE = /^[a-z][a-z0-9-]{2,59}$/;
const CheckBody = z.object({
  pseudoId: z.number().int().positive(),
  purpose: z.string().min(3).max(60),
});

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  const gated = requireGateway(deps.serviceAuthSecret, deps.log);

  function caller(req: Request, res: Response): { pseudoId: number; requestId: string } | undefined {
    const pseudoId = req.caller?.pseudoId;
    if (pseudoId === undefined) {
      res.status(401).json({ error: { code: 'no_session' } });
      return undefined;
    }
    return { pseudoId, requestId: req.caller?.requestId ?? randomUUID() };
  }


  // -------------------------------------------------------------- internal ---
  //
  // retention-service calls these. They have no gateway route and never will: a member
  // must not be able to ask one vault to purge anybody, including themselves, because a
  // deletion is a whole-platform act that a single vault cannot decide. Authenticated by
  // the service-auth signature like every other internal call; the pseudonym comes from
  // the body rather than the session, because retention-service acts FOR a member rather
  // than AS one.

  const PurgeBody = z.object({ pseudoId: z.number().int().positive() });

  app.post('/internal/purge', gated, async (req, res, next) => {
    try {
      const parsed = PurgeBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      res.status(200).json(await deps.repo.purge(parsed.data.pseudoId));
    } catch (err) {
      next(err);
    }
  });

  app.post('/internal/export', gated, async (req, res, next) => {
    try {
      const parsed = PurgeBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      res.status(200).json({ data: await deps.repo.exportFor(parsed.data.pseudoId) });
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------- internal ---

  /** May this member's content be processed for this purpose? */
  app.post('/internal/consent/check', gated, async (req, res, next) => {
    try {
      const parsed = CheckBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      const allowed = await deps.consent.isGranted(parsed.data.pseudoId, parsed.data.purpose);
      res.status(200).json({ allowed });
    } catch (err) {
      next(err);
    }
  });

  // --------------------------------------------------------------- member ---

  app.get('/api/consent/records', gated, async (req, res, next) => {
    try {
      const who = caller(req, res);
      if (who === undefined) return;
      res.status(200).json({ records: await deps.consent.history(who) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/consent/grant/:purpose', gated, async (req, res, next) => {
    try {
      const who = caller(req, res);
      if (who === undefined) return;
      const purpose = typeof req.params.purpose === 'string' ? req.params.purpose : '';
      if (!PURPOSE.test(purpose)) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      const outcome = await deps.consent.grant(who, purpose);
      if (!outcome.ok) {
        res.status(422).json({ error: { code: outcome.reason } });
        return;
      }
      res.status(201).json({ record: outcome.record });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Withdraw consent.
   *
   * NEVER GATED. `consent-withdrawal` is in the plans catalogue's `never_gated` list,
   * and this route is why that list exists: the ability to stop must not depend on
   * plan, payment status, or anything else. A member who cannot withdraw has not
   * given consent, they have been enrolled.
   *
   * 200 whether or not anything was granted. A member withdrawing twice, or
   * withdrawing something they never had, should not be told off — and the difference
   * would disclose what they had consented to in the first place.
   */
  app.post('/api/consent/withdraw/:purpose', gated, async (req, res, next) => {
    try {
      const who = caller(req, res);
      if (who === undefined) return;
      const purpose = typeof req.params.purpose === 'string' ? req.params.purpose : '';
      if (!PURPOSE.test(purpose)) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      await deps.consent.withdraw(who, purpose);
      res.status(200).json({
        withdrawn: true,
        message:
          'Consent withdrawn. Nothing you have already written has been removed, and ' +
          'you can read and delete it as before.',
      });
    } catch (err) {
      next(err);
    }
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'not_found' } });
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    deps.log.error(
      { err: err instanceof Error ? err.message : String(err), requestId: req.caller?.requestId },
      'unhandled error',
    );
    if (!res.headersSent) {
      res.status(500).json({ error: { code: 'internal_error' } });
    }
  });

  return app;
}
