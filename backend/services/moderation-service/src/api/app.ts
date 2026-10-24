/**
 * HTTP surface. No business logic — handlers validate, delegate and shape a response.
 *
 * Two audiences, split by path. `/api/moderation/*` is a member's own reports and
 * appeals, reached through the gateway. `/internal/*` is community-service recording a
 * decision, and has no gateway route — a verdict is written by this service or not at
 * all, which is what the grants enforce from the other side.
 */

import { randomUUID } from 'node:crypto';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { verifyRequest, type VerifiedCaller } from '@alaap/service-auth';
import { z } from 'zod';

import type { Caller, Moderation } from '../application/moderation.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      caller?: VerifiedCaller;
    }
  }
}

export interface AppDeps {
  moderation: Moderation;
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

const REF = /^[PR]-\d{6}$/;

const ReportBody = z.object({
  subjectType: z.enum(['post', 'comment']),
  subjectRef: z.string().regex(REF),
  reasonCode: z.string().min(2).max(40),
  /** A member's own words about what happened. Never enters the audit trail. */
  note: z.string().trim().max(1000).optional(),
});

const AppealBody = z.object({
  verdictId: z.string().uuid(),
  reasonCode: z.string().min(2).max(40),
  statement: z.string().trim().max(1000).optional(),
});

const RecordVerdictBody = z.object({
  commentRef: z.string().regex(REF),
  decision: z.enum([
    'allowed',
    'suggest_rewording',
    'limited_visibility',
    'blocked',
    'crisis_flag',
    'abuse_pattern',
  ]),
  categories: z.array(z.string().min(2).max(60)).max(16),
  modelId: z.string().min(1).max(120),
  modelVersion: z.string().min(1).max(120),
  latencyMs: z.number().int().min(0).max(120_000),
});

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  const gated = requireGateway(deps.serviceAuthSecret, deps.log);

  function caller(req: Request, res: Response): Caller | undefined {
    const pseudoId = req.caller?.pseudoId;
    if (pseudoId === undefined) {
      res.status(401).json({ error: { code: 'no_session' } });
      return undefined;
    }
    return { pseudoId, requestId: req.caller?.requestId ?? randomUUID() };
  }

  // ------------------------------------------------------------- internal ---

  /**
   * Record a decision about a reply. community-service calls this.
   *
   * Not on /api/moderation and not reachable through the gateway: a member who could
   * write verdicts could mark their own reply allowed.
   */
  app.post('/internal/verdicts/comment', gated, async (req, res, next) => {
    try {
      const parsed = RecordVerdictBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      const outcome = await deps.moderation.recordCommentVerdict({
        ...parsed.data,
        requestId: req.caller?.requestId ?? randomUUID(),
      });
      if (!outcome.ok) {
        res.status(outcome.reason === 'unknown_subject' ? 404 : 422).json({
          error: { code: outcome.reason },
        });
        return;
      }
      res.status(201).json({ verdict: outcome.verdict });
    } catch (err) {
      next(err);
    }
  });

  // --------------------------------------------------------------- member ---

  /** The reasons an interface offers. Metadata, so the words stay reviewable. */
  app.get('/api/moderation/reasons', gated, (req, res) => {
    if (caller(req, res) === undefined) return;
    res.status(200).json(deps.moderation.reasons());
  });

  app.post('/api/moderation/reports', gated, async (req, res, next) => {
    try {
      const who = caller(req, res);
      if (who === undefined) return;
      const parsed = ReportBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }

      const outcome = await deps.moderation.report(who, parsed.data);
      if (!outcome.ok) {
        res.status(outcome.reason === 'unknown_subject' ? 404 : 422).json({
          error: { code: outcome.reason },
        });
        return;
      }

      // The same 202 whether this is the first report or a repeat. "You have already
      // reported this" reads as a rebuke to somebody worried they were not heard, and
      // it also tells a probing account whether its earlier report landed.
      res.status(202).json({
        received: true,
        message: 'Thank you. Someone will look at this.',
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/moderation/appeals', gated, async (req, res, next) => {
    try {
      const who = caller(req, res);
      if (who === undefined) return;
      const parsed = AppealBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }

      const outcome = await deps.moderation.appeal(who, parsed.data);
      if (!outcome.ok) {
        // An unknown verdict and somebody else's are the same 404. Distinguishing them
        // would confirm that a particular reply existed and was blocked.
        const status =
          outcome.reason === 'unknown_verdict' ? 404 : outcome.reason === 'already_appealed' ? 409 : 422;
        res.status(status).json({ error: { code: outcome.reason } });
        return;
      }
      res.status(201).json({ appeal: outcome.appeal });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/moderation/appeals', gated, async (req, res, next) => {
    try {
      const who = caller(req, res);
      if (who === undefined) return;
      res.status(200).json({ appeals: await deps.moderation.myAppeals(who) });
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
