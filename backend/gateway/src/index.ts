/**
 * Gateway entry point.
 *
 * Boot order matters: metadata is loaded and cross-checked before anything binds a
 * port. A gateway that starts with an inconsistent route policy is worse than one
 * that refuses to start, because the inconsistency surfaces later as a route that is
 * silently unreachable — or silently reachable.
 */

import { Redis } from 'ioredis';

import { createApp } from './app.ts';
import { createAuditClient } from './audit/client.ts';
import { loadEnv } from './config/env.ts';
import { loadMetadata } from './config/metadata.ts';
import { SessionStore } from './infrastructure/session-store.ts';
import { createLogger } from './log.ts';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV);

  const metadata = loadMetadata(env.METADATA_ROOT);
  logger.info(
    { groups: metadata.groups.length, purposes: metadata.purposes.size },
    'route policy loaded and cross-checked',
  );

  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: false,
  });
  redis.on('error', (err) => logger.error({ err: err.message }, 'redis error'));

  const audit = createAuditClient(
    env.AUDIT_DATABASE_URL,
    (keys) => logger.warn({ dropped: keys }, 'audit context keys dropped'),
    (err) => logger.error({ err: err.message }, 'idle audit-vault client failed; pool will recover'),
  );
  const sessions = new SessionStore(redis, env.SESSION_MAX_ABSOLUTE_HOURS);

  const app = createApp({ env, metadata, redis, sessions, audit, logger });

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'privacy gateway listening');
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void Promise.allSettled([audit.close(), redis.quit()]).then(() => process.exit(0));
    });
    // Do not wait forever for in-flight requests to drain.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  // No logger here — this path includes "the environment failed to parse", which is
  // exactly when the logger may not exist.
  console.error('Gateway failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
