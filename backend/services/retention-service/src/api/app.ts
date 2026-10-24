/**
 * HTTP surface for data rights.
 *
 * Both routes sit behind `step_up: true` in the route policy, so the gateway has
 * already made the member prove, within the last fifteen minutes, that it is them. A
 * stolen session must not be able to exfiltrate an account's history or destroy it, and
 * those are exactly the two things here.
 */

import { randomUUID } from 'node:crypto';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { verifyRequest, type VerifiedCaller } from '@alaap/service-auth';

import type { Retention } from '../application/retention.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      caller?: VerifiedCaller;
    }
  }
}

export interface AppDeps {
  retention: Retention;
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

  /**
   * Everything you wrote, as JSON.
   *
   * Assembled on demand and never stored. Keeping a copy would mean that asking for
   * your data created a second one — which is the opposite of what was asked for.
   */
  app.get('/api/data-rights/export', gated, async (req, res, next) => {
    try {
      const who = caller(req, res);
      if (who === undefined) return;

      const data = await deps.retention.exportAll(who);
      res
        .status(200)
        .setHeader('content-disposition', 'attachment; filename="alaap-export.json"')
        .json(data);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Delete the account.
   *
   * POST rather than DELETE, because the response carries a receipt the member needs
   * to read — which vault, what happened in it, and what if anything survived a legal
   * hold. A 204 with an empty body would be the platform saying "done, trust us" about
   * the one operation where trust is exactly what is being tested.
   *
   * Irreversible, and not deferred. A grace period would mean the platform kept data
   * after being told to stop; the guard against an impulsive deletion is the step-up
   * the gateway already required, not a waiting room.
   */
  app.post('/api/data-rights/deletion', gated, async (req, res, next) => {
    try {
      const who = caller(req, res);
      if (who === undefined) return;

      const outcome = await deps.retention.deleteAccount(who);

      res.status(200).json({
        deleted: outcome.state === 'completed',
        state: outcome.state,
        receipt: outcome.receipt,
        detail: outcome.detail,
        message:
          outcome.state === 'completed'
            ? 'Your account and everything in it has been deleted. The audit trail keeps a ' +
              'record that this happened — it holds no words you wrote, and now that your ' +
              'handle is gone it points at nobody. It is what proves we did this.'
            : 'Most of your account has been deleted. Some records could not be removed yet; ' +
              'what and why is below. The audit trail keeps a record that this happened.',
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
