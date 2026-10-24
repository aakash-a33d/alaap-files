/**
 * HTTP surface for the clinical vault.
 *
 * Two entitlements, drawn differently on purpose:
 *
 *   journal, stories   PAID. Unbounded non-expiring storage in the clinical vault,
 *                      per-record envelope encryption, a KMS operation per read.
 *                      Unlike a reply, these carry real ongoing cost.
 *   mood check-in      FREE, on every plan. A single number, cost indistinguishable
 *                      from zero, and the lowest-friction way for somebody to begin
 *                      engaging at all.
 *
 * That split is the plans metadata's, not this file's, and is read from it.
 */

import { randomUUID } from 'node:crypto';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { verifyRequest, type VerifiedCaller } from '@alaap/service-auth';
import { z } from 'zod';

import type { ClinicalPurge } from '../infrastructure/purge.ts';

import type { Clinical } from '../application/clinical.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      caller?: VerifiedCaller;
    }
  }
}

export interface AppDeps {
  clinical: Clinical;
  /** Export and purge for this vault. Reached only by retention-service. */
  purge: ClinicalPurge;
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
 * A journal entry.
 *
 * 20,000 characters. Far longer than a post, deliberately: a journal is the surface
 * somebody writes at length on, privately, and a limit that interrupts that is the
 * limit doing harm.
 */
const JournalBody = z.object({
  body: z.string().trim().min(1).max(20_000),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const MoodBody = z.object({
  moodScore: z.number().int().min(1).max(10),
  energyScore: z.number().int().min(1).max(10).optional(),
  sleepHours: z.number().min(0).max(24).optional(),
  stressScore: z.number().int().min(1).max(10).optional(),
  emotionTags: z.array(z.string().min(1).max(30)).max(10).optional(),
});

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  // Larger than the other services because a journal entry legitimately is.
  app.use(express.json({ limit: '256kb' }));

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

  function param(req: Request, name: string): string {
    const value = req.params[name];
    return typeof value === 'string' ? value : '';
  }

  /**
   * An entry id, or undefined.
   *
   * Checked before it reaches a query. Postgres rejects a malformed uuid with an error
   * that surfaces as a 500, which tells a caller that something broke rather than that
   * they asked for something that does not exist — and 500s on a member-facing route
   * are how a real outage gets lost in noise.
   */
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function entryId(req: Request): string | undefined {
    const value = param(req, 'id');
    return UUID.test(value) ? value : undefined;
  }

  /** Shape a refusal. Quota and entitlement are different answers to a member. */
  function refuse(res: Response, outcome: { reason: string; detail?: unknown }): void {
    if (outcome.reason === 'not_entitled') {
      // 402, not 429. This is not a rate that resets — it is a feature on another
      // plan, and saying so plainly is kinder than implying they should wait.
      res.status(402).json({
        error: {
          code: 'not_entitled',
          message: 'Journals are part of Interaction Plus.',
        },
      });
      return;
    }
    if (outcome.reason === 'quota_exceeded') {
      const q = outcome.detail as { limit: number; used: number; resetsAt: string };
      res.status(429).json({ error: { code: 'quota_exceeded', ...q } });
      return;
    }
    if (outcome.reason === 'consent_withdrawn') {
      // The member withdrew consent for this purpose. Their existing entries are
      // untouched and still theirs; what stops is new processing under that purpose.
      res.status(451).json({
        error: {
          code: 'consent_withdrawn',
          message: 'You withdrew consent for this. Nothing already written was removed.',
        },
      });
      return;
    }
    res.status(422).json({ error: { code: outcome.reason } });
  }


  // -------------------------------------------------------------- internal ---
  //
  // retention-service calls these. They have no gateway route and never will: a
  // member must not be able to ask this service to purge anybody, including
  // themselves — a deletion is a whole-platform act that one vault cannot decide.
  // The caller is authenticated by the service-auth signature like every other
  // internal call, and the pseudonym comes from the body rather than the session,
  // because retention-service is acting for a member rather than as one.

  const PurgeBody = z.object({ pseudoId: z.number().int().positive() });

  app.post('/internal/purge', gated, async (req, res, next) => {
    try {
      const parsed = PurgeBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      res.status(200).json(await deps.purge.purge(parsed.data.pseudoId));
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
      res.status(200).json(await deps.purge.exportFor(parsed.data.pseudoId));
    } catch (err) {
      next(err);
    }
  });

  // ---------------------------------------------------------------- journal ---

  app.post('/api/journal/entries', gated, async (req, res, next) => {
    try {
      const who = caller(req, res);
      if (who === undefined) return;
      const parsed = JournalBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      const outcome = await deps.clinical.writeJournal(who, parsed.data);
      if (!outcome.ok) return refuse(res, outcome);
      res.status(201).json({ entry: outcome.entry });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/journal/entries', gated, async (req, res, next) => {
    try {
      const who = caller(req, res);
      if (who === undefined) return;
      res.status(200).json({ entries: await deps.clinical.listJournal(who) });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/journal/entries/:id', gated, async (req, res, next) => {
    try {
      const who = caller(req, res);
      if (who === undefined) return;
      const id = entryId(req);
      const entry = id === undefined ? undefined : await deps.clinical.readJournal(who, id);
      if (entry === undefined) {
        res.status(404).json({ error: { code: 'not_found' } });
        return;
      }
      res.status(200).json({ entry });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/journal/entries/:id', gated, async (req, res, next) => {
    try {
      const who = caller(req, res);
      if (who === undefined) return;
      const id = entryId(req);
      const gone = id === undefined ? false : await deps.clinical.deleteJournal(who, id);
      res.status(gone ? 204 : 404).json(gone ? undefined : { error: { code: 'not_found' } });
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------------- mood ---
  //
  // Never gated. Free on every plan, and not conditioned on quota, payment status or
  // consent — it is the lowest-friction way for somebody to begin engaging at all.

  app.post('/api/mood/checkins', gated, async (req, res, next) => {
    try {
      const who = caller(req, res);
      if (who === undefined) return;
      const parsed = MoodBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      res.status(201).json({ checkin: await deps.clinical.recordMood(who, parsed.data) });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/mood/checkins', gated, async (req, res, next) => {
    try {
      const who = caller(req, res);
      if (who === undefined) return;
      const days = Math.min(Math.max(Number(req.query.days ?? 30) || 30, 1), 365);
      res.status(200).json({ checkins: await deps.clinical.moodHistory(who, days) });
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
