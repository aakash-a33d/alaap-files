/**
 * consent-service entry point.
 *
 * Decides whether processing is permitted, and can read none of the content it is
 * deciding about — `journal_entries` and `short_stories` are withheld from this role
 * in the grants. The service that holds the content has no write here in return.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';
import { pino } from 'pino';
import { PostgresAuditClient } from '@alaap/audit-client';

import { createApp } from './api/app.ts';
import { Consent } from './application/consent.ts';
import { loadEnv } from './config/env.ts';
import { createConsentPool, ConsentRepository } from './infrastructure/consent.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '../../../..');

async function main(): Promise<void> {
  const env = loadEnv();
  const log = pino({
    level: env.LOG_LEVEL,
    base: { service: 'consent-service' },
    redact: { paths: ['req.headers'], censor: '[redacted]' },
  });

  // The declared purposes. A consent record for a purpose the platform does not claim
  // to process for is one nobody can act on, so the registry is authoritative here
  // rather than the table.
  const root = env.METADATA_ROOT ?? DEFAULT_ROOT;
  const registry = parseYaml(
    readFileSync(resolve(root, 'metadata/consent/purpose-registry/purposes.v1.yaml'), 'utf8'),
  ) as { purposes: { id: string }[] };
  const purposes = new Set(registry.purposes.map((p) => p.id));
  if (purposes.size === 0) throw new Error('purpose registry is empty');
  log.info({ purposes: purposes.size }, 'purpose registry loaded');

  const pool = createConsentPool(env.CLINICAL_DATABASE_URL, log);
  const repo = new ConsentRepository(pool);
  const audit = new PostgresAuditClient({
    onPoolError: (err) =>
      log.error({ err: err.message }, 'idle audit-vault client failed; pool will recover'),
    connectionString: env.AUDIT_DATABASE_URL,
    applicationName: 'alaap-consent-service',
    onDroppedContext: (keys) => log.warn({ keys }, 'audit context keys dropped'),
  });

  const app = createApp({
    consent: new Consent({ repo, purposes, audit, log }),
    repo,
    serviceAuthSecret: env.SERVICE_AUTH_SECRET,
    log,
  });

  const server = app.listen(env.PORT, () => {
    log.info({ port: env.PORT, env: env.NODE_ENV }, 'consent-service listening');
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
  console.error('consent-service failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
