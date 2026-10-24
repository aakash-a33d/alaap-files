/**
 * community-service entry point.
 *
 * Owns posts, replies, reports and account restrictions in community_vault. It can
 * read personas but never write one, and has no credential on any other vault — so a
 * compromise here yields post bodies and pseudo ids, and nothing that says who wrote
 * them.
 */

import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pino } from 'pino';
import { PostgresAuditClient } from '@alaap/audit-client';

import { createApp } from './api/app.ts';
import { Community } from './application/community.ts';
import { loadEnv } from './config/env.ts';
import { loadCategories } from './config/categories.ts';
import { loadPlans } from './config/plans.ts';
import { AiClient, ModerationClient, SupportiveClient } from './infrastructure/ai-client.ts';
import { CommunityPurge } from './infrastructure/purge.ts';
import { createCommunityPool, PostRepository } from './infrastructure/posts.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** src/ -> service root -> services -> backend -> repository root */
const DEFAULT_ROOT = resolve(HERE, '../../../..');

async function main(): Promise<void> {
  const env = loadEnv();
  const log = pino({
    level: env.LOG_LEVEL,
    base: { service: 'community-service' },
    // A post body in a log line is the most sensitive thing this service holds, and
    // logs are retained differently from the vault. This is the backstop rather than
    // the policy — nothing here logs a body deliberately.
    redact: {
      paths: ['*.body', '*.text', 'req.headers'],
      censor: '[redacted]',
    },
  });

  // Throws rather than warns. Every invariant it checks is a quota a member would be
  // held to — see config/plans.ts.
  const catalogue = loadPlans(env.METADATA_ROOT ?? DEFAULT_ROOT);
  log.info(
    {
      plans: catalogue.plans.length,
      neverGated: catalogue.neverGated.size,
      freePosts: catalogue.plans.find((p) => p.tier === 0)?.quotas.postsPerMonth,
    },
    'plan catalogue loaded',
  );

  const pool = createCommunityPool(env.COMMUNITY_DATABASE_URL, log);
  const posts = new PostRepository(pool);
  const purge = new CommunityPurge(pool);
  const audit = new PostgresAuditClient({
    onPoolError: (err) =>
      log.error({ err: err.message }, 'idle audit-vault client failed; pool will recover'),
    connectionString: env.AUDIT_DATABASE_URL,
    applicationName: 'alaap-community-service',
    onDroppedContext: (keys) => log.warn({ keys }, 'audit context keys dropped'),
  });

  const community = new Community({
    posts,
    ai: new AiClient(env.UPSTREAM_AI_ORCHESTRATOR, env.SERVICE_AUTH_SECRET),
    moderation: new ModerationClient(env.UPSTREAM_MODERATION_SERVICE, env.SERVICE_AUTH_SECRET),
    audit,
    catalogue,
    log,
  });

  const categories = loadCategories(env.METADATA_ROOT ?? DEFAULT_ROOT);
  log.info({ categories: categories.length }, 'post categories loaded');

  const app = createApp({
    community,
    purge,
    categories,
    serviceAuthSecret: env.SERVICE_AUTH_SECRET,
    log,
  });

  const server = app.listen(env.PORT, () => {
    log.info({ port: env.PORT, env: env.NODE_ENV }, 'community-service listening');
  });

  /**
   * B1 — the supportive response worker.
   *
   * One post at a time, claimed under `FOR UPDATE SKIP LOCKED`, so running two of
   * these never writes two AI replies to one post.
   *
   * Drains rather than taking one per tick: after a quiet night there may be a
   * backlog, and a member should not wait five seconds per post ahead of them in the
   * queue. Bounded so a very large backlog cannot hold the loop indefinitely.
   */
  const supportive = new SupportiveClient(env.UPSTREAM_AI_ORCHESTRATOR, env.SERVICE_AUTH_SECRET);

  let draining = false;
  async function drainResponses(): Promise<void> {
    if (draining) return; // a slow generation must not have two drains overlapping
    draining = true;
    try {
      for (let handled = 0; handled < 20; handled += 1) {
        const done = await posts.withPendingResponse((body) =>
          supportive.respond({ body, requestId: randomUUID() }),
        );
        if (done === undefined) return;
        log.info({ post: done.ref, wrote: done.wrote }, 'supportive response');
      }
    } catch (err) {
      log.error(
        { err: err instanceof Error ? err.message : String(err) },
        'supportive response worker failed',
      );
    } finally {
      draining = false;
    }
  }

  const responder =
    env.RESPONSE_WORKER_SECONDS > 0
      ? setInterval(() => void drainResponses(), env.RESPONSE_WORKER_SECONDS * 1000)
      : undefined;
  responder?.unref();

  /**
   * The expiry sweep.
   *
   * It changes state; it is not what makes a post invisible. The feed filters on
   * `expires_at` independently, so a post disappears the instant its five days are up
   * however long this interval is — a member was promised five days, not five days
   * plus however long until the next sweep.
   *
   * `unref` so a stopped service is not held open by a pending timer.
   */
  const sweep =
    env.EXPIRY_SWEEP_SECONDS > 0
      ? setInterval(() => {
          posts
            .expirePosts()
            .then((n) => {
              if (n > 0) log.info({ expired: n }, 'posts expired');
            })
            .catch((err: unknown) => {
              log.error(
                { err: err instanceof Error ? err.message : String(err) },
                'expiry sweep failed',
              );
            });
        }, env.EXPIRY_SWEEP_SECONDS * 1000)
      : undefined;
  sweep?.unref();

  const shutdown = (signal: string): void => {
    log.info({ signal }, 'shutting down');
    if (sweep !== undefined) clearInterval(sweep);
    if (responder !== undefined) clearInterval(responder);
    server.close(() => {
      void Promise.allSettled([posts.close(), audit.close()]).then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('community-service failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
