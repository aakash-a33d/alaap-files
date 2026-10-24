/**
 * pseudonym-service entry point.
 *
 * Owns the public persona: pseudo_profiles (handle included) and block
 * lists. It can read none of the content those personas produce.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pino } from 'pino';
import { PostgresAuditClient } from '@alaap/audit-client';

import { createApp } from './api/app.ts';
import { loadEnv } from './config/env.ts';
import { loadHandlePolicy } from './config/handle-policy.ts';
import { handleSpaceSize } from './domain/handle.ts';
import { PersonaRepository } from './infrastructure/personas.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** src/ -> service root -> services -> backend -> repository root */
const DEFAULT_ROOT = resolve(HERE, '../../../..');

async function main(): Promise<void> {
  const env = loadEnv();
  const log = pino({ level: env.LOG_LEVEL, base: { service: 'pseudonym-service' } });

  // Throws rather than warns. Every invariant it checks produces a failure that is
  // invisible in development and serious in production — see config/handle-policy.ts.
  const policy = loadHandlePolicy(env.METADATA_ROOT ?? DEFAULT_ROOT);
  log.info(
    {
      space: handleSpaceSize(policy),
      adjectives: policy.adjectives.length,
      nouns: policy.nouns.length,
    },
    'handle vocabulary loaded',
  );

  const personas = new PersonaRepository(env.COMMUNITY_DATABASE_URL, policy, log);
  const audit = new PostgresAuditClient({
    onPoolError: (err) =>
      log.error({ err: err.message }, 'idle audit-vault client failed; pool will recover'),
    connectionString: env.AUDIT_DATABASE_URL,
    applicationName: 'alaap-pseudonym-service',
    onDroppedContext: (keys) => {
      // A dropped key means a caller tried to put something in the audit trail that
      // the allowlist does not permit. Never silent: the allowlist is what keeps a
      // real name out of the audit vault, and a writer fighting it is a bug.
      log.warn({ keys }, 'audit context keys dropped');
    },
  });
  const app = createApp({
    personas,
    policy,
    audit,
    serviceAuthSecret: env.SERVICE_AUTH_SECRET,
    log,
  });

  const server = app.listen(env.PORT, () => {
    log.info({ port: env.PORT }, 'pseudonym-service listening');
  });

  const shutdown = (signal: string): void => {
    log.info({ signal }, 'shutting down');
    server.close(() => {
      void personas.close().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('pseudonym-service failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
