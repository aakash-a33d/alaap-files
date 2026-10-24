/**
 * HTTP surface. No business logic — handlers validate, delegate and shape a response.
 *
 * Every route requires a valid gateway signature. A request that reaches this port
 * directly is refused, which matters because the port is published to localhost in
 * development and would otherwise be an unauthenticated way to write into the feed.
 */

import { randomUUID } from 'node:crypto';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { verifyRequest, type VerifiedCaller } from '@alaap/service-auth';
import { z } from 'zod';

import type { CommunityPurge } from '../infrastructure/purge.ts';

import type { Caller, Community } from '../application/community.ts';
import { isWellFormedRef } from '../domain/refs.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      caller?: VerifiedCaller;
    }
  }
}

export interface AppDeps {
  community: Community;
  /** Export and purge for this vault. Reached only by retention-service. */
  purge: CommunityPurge;
  /** Ids and the words for them. Served so the client cannot ship its own list. */
  categories: { id: string; label: string; blurb: string }[];
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
      // Logged with the reason, answered without it. A precise reason is a probing
      // oracle; the caller learns only that it was refused.
      log.warn({ reason: outcome.reason, path: req.path }, 'rejected unsigned request');
      res.status(401).json({ error: { code: 'service_auth_required' } });
      return;
    }
    req.caller = outcome.caller;
    next();
  };
}

/**
 * A post body.
 *
 * 4,000 characters is long — deliberately. Somebody writing at 3am about the worst
 * week of their life should not hit a limit mid-sentence and have to edit themselves
 * down before they are allowed to finish.
 */
const CreatePostBody = z.object({
  categoryId: z.string().min(2).max(40),
  body: z.string().trim().min(1).max(4000),
  /** Ignored on plans that cannot extend; clamped rather than refused. */
  visibilityDays: z.number().int().min(1).max(30).optional(),
});

const CreateReplyBody = z.object({
  body: z.string().trim().min(1).max(2000),
});

const FeedQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.string().datetime().optional(),
  category: z.string().min(2).max(40).optional(),
});

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  const gated = requireGateway(deps.serviceAuthSecret, deps.log);

  /**
   * A route parameter as a single string.
   *
   * Express 5 types `req.params` values as `string | string[]`, because a route CAN
   * declare a repeated parameter. None here does, so an array means somebody sent a
   * shape the route does not define - taking the first element would be guessing at
   * what they meant, and the refs below are validated immediately afterwards anyway.
   */
  function param(req: Request, name: string): string {
    const value = req.params[name];
    return typeof value === 'string' ? value : '';
  }

  /**
   * The caller, from the gateway's signed headers and nowhere else.
   *
   * A pseudo id taken from the body would be a route for posting as somebody else.
   */
  function caller(req: Request, res: Response): Caller | undefined {
    const pseudoId = req.caller?.pseudoId;
    if (pseudoId === undefined) {
      res.status(401).json({ error: { code: 'no_session' } });
      return undefined;
    }
    return { pseudoId, requestId: req.caller?.requestId ?? randomUUID() };
  }

  // ------------------------------------------------------------------ posts ---

  app.post('/api/community/posts', gated, async (req, res, next) => {
    try {
      const who = caller(req, res);
      if (who === undefined) return;
      const parsed = CreatePostBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }

      const outcome = await deps.community.createPost(who, parsed.data);
      if (!outcome.ok) {
        if (outcome.reason === 'unknown_category') {
          res.status(422).json({ error: { code: 'unknown_category' } });
          return;
        }
        // 429, not 402. A quota is a rate, not a paywall — and the response says when
        // it resets so a member can answer "when can I post again?" without asking.
        const quota = outcome.quota as { limit: number; used: number; resetsAt: string };
        res.status(429).json({
          error: {
            code: 'quota_exceeded',
            limit: quota.limit,
            used: quota.used,
            resetsAt: quota.resetsAt,
          },
        });
        return;
      }
      res.status(201).json({ post: outcome.post });
    } catch (err) {
      next(err);
    }
  });

  /**
   * The member's plan, and what it permits.
   *
   * Read-only and touches no vault — the catalogue is metadata and the answer is the
   * same for everybody on the same tier. Served from here rather than a billing
   * service because this is where the plan is resolved and the quotas are enforced,
   * and two places deciding what a plan allows is how they come to disagree.
   */
  /**
   * The categories a post may carry.
   *
   * Served rather than duplicated in the client, because the WORDS are the decision
   * here: these are situations, not conditions. A client shipping its own list drifts
   * — and it had, offering "Anxiety" and "Trauma recovery" to a server that refuses
   * both as unknown categories.
   */

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

  app.get('/api/community/categories', gated, (req, res) => {
    if (caller(req, res) === undefined) return;
    res.status(200).json({ categories: deps.categories });
  });

  app.get('/api/community/entitlements', gated, (req, res) => {
    const who = caller(req, res);
    if (who === undefined) return;
    res.status(200).json({ plan: deps.community.entitlements(who) });
  });

  app.get('/api/community/feed', gated, async (req, res, next) => {
    try {
      if (caller(req, res) === undefined) return;
      const parsed = FeedQuery.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }
      const posts = await deps.community.feed({
        limit: parsed.data.limit,
        before: parsed.data.before,
        categoryId: parsed.data.category,
      });
      res.status(200).json({ posts });
    } catch (err) {
      next(err);
    }
  });

  /** A member's own posts, expired ones included — they wrote them. */
  app.get('/api/community/posts/mine', gated, async (req, res, next) => {
    try {
      const who = caller(req, res);
      if (who === undefined) return;
      res.status(200).json({ posts: await deps.community.ownPosts(who) });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/community/posts/:ref', gated, async (req, res, next) => {
    try {
      if (caller(req, res) === undefined) return;
      const ref = param(req, 'ref');
      if (!isWellFormedRef(ref)) {
        res.status(404).json({ error: { code: 'not_found' } });
        return;
      }
      const found = await deps.community.post(ref);
      // The same 404 for a post that never existed and one that has expired. The
      // difference would let somebody confirm that a particular ref was once real.
      if (found === undefined || found.post.state !== 'published') {
        res.status(404).json({ error: { code: 'not_found' } });
        return;
      }
      res.status(200).json(found);
    } catch (err) {
      next(err);
    }
  });

  // ---------------------------------------------------------------- replies ---

  app.post('/api/community/posts/:ref/replies', gated, async (req, res, next) => {
    try {
      const who = caller(req, res);
      if (who === undefined) return;
      const ref = param(req, 'ref');
      const parsed = CreateReplyBody.safeParse(req.body);
      if (!isWellFormedRef(ref) || !parsed.success) {
        res.status(400).json({ error: { code: 'invalid_request' } });
        return;
      }

      const outcome = await deps.community.createReply(who, { postRef: ref, body: parsed.data.body });
      if (outcome.ok) {
        res.status(201).json({ reply: outcome.reply });
        return;
      }

      switch (outcome.reason) {
        case 'quota_exceeded': {
          const quota = outcome.quota as { limit: number; used: number; resetsAt: string };
          res.status(429).json({
            error: {
              code: 'quota_exceeded',
              limit: quota.limit,
              used: quota.used,
              resetsAt: quota.resetsAt,
            },
          });
          return;
        }
        case 'post_unavailable':
          res.status(404).json({ error: { code: 'not_found' } });
          return;
        case 'blocked':
          // 422 with the orchestrator's own wording, which is written for a person.
          // No scores, no categories, no model id — naming the classifier that fired
          // would tell somebody exactly what to rephrase.
          // The verdict id is returned so the member can appeal this decision. It
          // identifies a row, not a reason — no scores, no categories, no model id.
          res.status(422).json({
            error: {
              code: 'blocked',
              message: outcome.message,
              ...(outcome.verdictId !== undefined ? { verdictId: outcome.verdictId } : {}),
            },
          });
          return;
        case 'moderation_unavailable':
          // 503, and honest about it. The reply was not published and was not lost:
          // the member is asked to try again rather than told they did something wrong.
          res.status(503).json({
            error: {
              code: 'moderation_unavailable',
              message: 'We could not check this reply just now. Please try again in a moment.',
            },
          });
          return;
      }
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
