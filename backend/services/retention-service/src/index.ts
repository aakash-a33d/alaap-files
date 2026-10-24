/**
 * retention-service entry point.
 *
 * Deletes a member's entire history across five vaults and holds a credential for
 * none of them. Its only database is `core`, where its four bookkeeping tables live;
 * it cannot CONNECT to community_vault or clinical_vault at all, and the privilege
 * suite asserts that by trying.
 *
 * Everything else happens by asking the service that owns the vault, over a signed
 * `/internal/` route with no gateway path. That is slower and chattier than one role
 * with DELETE everywhere, and it is the entire point: a compromised credential here
 * reaches a request ledger rather than every member's journal.
 */

import { pino } from 'pino';
import { PostgresAuditClient } from '@alaap/audit-client';

import { createApp } from './api/app.ts';
import { Retention } from './application/retention.ts';
import { loadEnv, loadUpstreams } from './config/env.ts';
import { PurgeClient } from './infrastructure/purge-client.ts';
import { createCorePool, RequestRepository } from './infrastructure/requests.ts';

async function main(): Promise<void> {
  const env = loadEnv();
  const log = pino({
    level: env.LOG_LEVEL,
    base: { service: 'retention-service' },
    redact: { paths: ['req.headers'], censor: '[redacted]' },
  });

  const upstreams = loadUpstreams(log);
  log.info({ vaults: upstreams.size }, 'purge targets resolved');

  const pool = createCorePool(env.CORE_DATABASE_URL, log);
  const repo = new RequestRepository(pool);
  const audit = new PostgresAuditClient({
    connectionString: env.AUDIT_DATABASE_URL,
    applicationName: 'alaap-retention-service',
    onDroppedContext: (keys) => log.warn({ keys }, 'audit context keys dropped'),
    onPoolError: (err) =>
      log.error({ err: err.message }, 'idle audit-vault client failed; pool will recover'),
  });

  const retention = new Retention({
    repo,
    purge: new PurgeClient(env.SERVICE_AUTH_SECRET),
    audit,
    upstreams,
    log,
  });

  const app = createApp({ retention, serviceAuthSecret: env.SERVICE_AUTH_SECRET, log });

  const server = app.listen(env.PORT, () => {
    log.info({ port: env.PORT, env: env.NODE_ENV }, 'retention-service listening');
  });

  async function shutdown(signal: string): Promise<void> {
    log.info({ signal }, 'shutting down');
    server.close();
    await repo.close_();
    await audit.close();
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('retention-service failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
