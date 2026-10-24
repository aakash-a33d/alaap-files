/**
 * moderation-service entry point.
 *
 * Owns verdicts, reviews and appeals. It reads content in order to judge it and may
 * change a post or comment's state, but has no write on any body — the grants enforce
 * that, and it is the reason community-service asks this service to record a decision
 * rather than writing one itself.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pino } from 'pino';
import { PostgresAuditClient } from '@alaap/audit-client';

import { createApp } from './api/app.ts';
import { Moderation } from './application/moderation.ts';
import { loadEnv } from './config/env.ts';
import { loadPolicy } from './config/policy.ts';
import { createModerationPool, ModerationRepository } from './infrastructure/moderation.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** src/ -> service root -> services -> backend -> repository root */
const DEFAULT_ROOT = resolve(HERE, '../../../..');

async function main(): Promise<void> {
  const env = loadEnv();
  const log = pino({
    level: env.LOG_LEVEL,
    base: { service: 'moderation-service' },
    // A report note is a member's own words about something that happened to them.
    // The backstop, not the policy: nothing here logs one deliberately.
    redact: { paths: ['*.note', '*.statement', '*.body', 'req.headers'], censor: '[redacted]' },
  });

  // Throws rather than warns. The loudest check is that the category list still
  // matches A1's enum: a category id that differs by a character produces verdicts
  // nobody can join to anything, and nothing else would notice.
  const policy = loadPolicy(env.METADATA_ROOT ?? DEFAULT_ROOT);
  log.info(
    {
      categories: policy.categories.length,
      reportReasons: policy.reportReasons.length,
      appealReasons: policy.appealReasons.length,
    },
    'moderation policy loaded',
  );

  const pool = createModerationPool(env.COMMUNITY_DATABASE_URL, log);
  const repo = new ModerationRepository(pool);
  const audit = new PostgresAuditClient({
    onPoolError: (err) =>
      log.error({ err: err.message }, 'idle audit-vault client failed; pool will recover'),
    connectionString: env.AUDIT_DATABASE_URL,
    applicationName: 'alaap-moderation-service',
    onDroppedContext: (keys) => log.warn({ keys }, 'audit context keys dropped'),
  });

  // Fail at startup, not on the first blocked reply. Without a policy version a
  // verdict cannot be written, and a moderation call that cannot be recorded fails
  // closed - which would refuse every reply on the platform.
  const version = await repo.currentPolicyVersion();
  log.info({ policyVersion: version }, 'active moderation policy version');

  const moderation = new Moderation({ repo, policy, audit, log });
  const app = createApp({ moderation, serviceAuthSecret: env.SERVICE_AUTH_SECRET, log });

  const server = app.listen(env.PORT, () => {
    log.info({ port: env.PORT, env: env.NODE_ENV }, 'moderation-service listening');
  });

  const shutdown = (signal: string): void => {
    log.info({ signal }, 'shutting down');
    server.close(() => {
      void Promise.allSettled([repo.close(), audit.close()]).then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('moderation-service failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
