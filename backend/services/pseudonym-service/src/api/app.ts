/**
 * HTTP surface. No business logic — handlers validate, delegate and shape a response.
 *
 * Every route requires a valid gateway signature. A request that reaches this port
 * directly is refused, which matters because the port is published to localhost in
 * development and would otherwise be an unauthenticated persona factory.
 */

import { randomUUID } from 'node:crypto';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { verifyRequest, type VerifiedCaller } from '@alaap/service-auth';
import type { AuditClient } from '@alaap/audit-client';
import { z } from 'zod';

import type { HandlePolicy } from '../domain/handle.ts';
import type { PersonaRepository } from '../infrastructure/personas.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      caller?: VerifiedCaller;
    }
  }
}

export interface AppDeps {
  personas: PersonaRepository;
  policy: HandlePolicy;
  audit: AuditClient;
  serviceAuthSecret: string;
  log: { info(o: object, m?: string): void; warn(o: object, m?: string): void; error(o: object, m?: string): void };
}

function requireGateway(secret: string, log: AppDeps['log']) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const outcome = verifyRequest(req.headers, secret);
    if (!outcome.ok) {
      // Logged with the reason, answered without it. A caller learns that it was
      // refused, never which check failed — a precise reason is a probing oracle.
      log.warn({ reason: outcome.reason, path: req.path }, 'rejected unsigned request');
      res.status(401).json({ error: { code: 'service_auth_required' } });
      return;
    }
    req.caller = outcome.caller;
    next();
  };
}

const CreateBody = z.object({
  pseudoId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

const LookupBody = z.object({
  handle: z.string().min(3).max(40),
});

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  const gated = requireGateway(deps.serviceAuthSecret, deps.log);

  /**
   * Create a persona for a pseudo_id auth-service has allocated.
   *
   * Internal: auth-service calls this during registration. It is not on
   * /api/pseudonym, so a member cannot mint themselves a second persona.
   */
  app.post('/internal/personas', gated, async (req, res, next) => {
    try {
      const parsed = CreateBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      const outcome = await deps.personas.create(parsed.data.pseudoId);

      // Only on a real creation. A retried registration returns the existing persona,
      // and writing a second `created` event for it would put something untrue in an
      // append-only log that nobody can correct afterwards.
      if (outcome.created) {
        await deps.audit.write({
          // randomUUID, not a sentinel: request_id is a NOT NULL uuid column, so a
          // placeholder would fail the insert — and a failed audit write fails the
          // operation it was recording. `gated` guarantees a caller, so the fallback
          // is unreachable; it just must not be unreachable AND wrong.
          requestId: req.caller?.requestId ?? randomUUID(),
          pseudoId: outcome.persona.pseudoId,
          // No actorId. That column holds the identity-vault account id, and this
          // service must not know it — the whole point of the split is that whoever
          // can see personas cannot see accounts.
          actorRole: 'service',
          serviceName: 'pseudonym-service',
          actionType: 'pseudonym.persona.created',
          purpose: 'account-recovery',
          consentDecision: 'not_required',
          accessResult: 'allowed',
          // Never the handle. It is the one field here that appears in public beside
          // everything this member writes, and the audit vault is read by staff.
          context: { record_kind: 'persona' },
        });
      }

      res.status(201).json({ persona: outcome.persona });
    } catch (err) {
      next(err);
    }
  });

  /** The caller's own persona. Resolved from the signed header, never the body. */

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
      res.status(200).json(await deps.personas.purge(parsed.data.pseudoId));
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
      res.status(200).json({ data: await deps.personas.exportFor(parsed.data.pseudoId) });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/pseudonym/me', gated, async (req, res, next) => {
    try {
      const pseudoId = req.caller?.pseudoId;
      if (pseudoId === undefined) {
        res.status(401).json({ error: { code: 'no_session' } });
        return;
      }
      const persona = await deps.personas.find(pseudoId);
      if (persona === undefined) {
        res.status(404).json({ error: { code: 'no_persona' } });
        return;
      }
      res.status(200).json({ persona });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Resolve a handle to a persona. Internal — auth-service calls it so a member can
   * log in with their handle as a username.
   *
   * Returns the persona or 404. That distinction is safe here and nowhere else: a
   * handle appears on every post its owner writes, so whether one exists is already
   * public. What auth-service must not do is let the ANSWER differ in its own
   * response, because whether that persona has a usable account is not public.
   */
  app.post('/internal/personas/by-handle', gated, async (req, res, next) => {
    try {
      const parsed = LookupBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      const persona = await deps.personas.findByHandle(parsed.data.handle);
      if (persona === undefined) {
        res.status(404).json({ error: { code: 'no_persona' } });
        return;
      }
      res.status(200).json({ persona });
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
