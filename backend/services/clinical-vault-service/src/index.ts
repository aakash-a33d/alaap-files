/**
 * clinical-vault-service entry point.
 *
 * Holds the most sensitive content on the platform, and holds none of it in the clear.
 * Every body is sealed with a per-record key before it reaches the database, and that
 * key is wrapped by OpenBao — so the database alone yields ciphertext, and OpenBao
 * alone yields the ability to unwrap keys for ciphertext it does not have.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pino } from 'pino';
import { PostgresAuditClient } from '@alaap/audit-client';
import { TransitClient } from '@alaap/crypto-client';

import { createApp } from './api/app.ts';
import { Clinical } from './application/clinical.ts';
import { loadEnv } from './config/env.ts';
import { loadPlans } from './config/plans.ts';
import { ConsentClient } from './infrastructure/consent-client.ts';
import { ClinicalPurge } from './infrastructure/purge.ts';
import { createClinicalPool, RecordRepository } from './infrastructure/records.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '../../../..');

async function main(): Promise<void> {
  const env = loadEnv();
  const log = pino({
    level: env.LOG_LEVEL,
    base: { service: 'clinical-vault-service' },
    // A journal entry in a log line would be the one place on the platform where this
    // content exists unencrypted at rest. The backstop, not the policy.
    redact: { paths: ['*.body', '*.entry', 'req.headers'], censor: '[redacted]' },
  });

  const catalogue = loadPlans(env.METADATA_ROOT ?? DEFAULT_ROOT);

  const transit = new TransitClient({
    address: env.OPENBAO_ADDR,
    token: env.OPENBAO_TOKEN,
    keyId: env.CLINICAL_KEY_ID,
  });

  const pool = createClinicalPool(env.CLINICAL_DATABASE_URL, log);
  const records = new RecordRepository(pool, transit);
  const purge = new ClinicalPurge(pool, transit);
  const audit = new PostgresAuditClient({
    onPoolError: (err) =>
      log.error({ err: err.message }, 'idle audit-vault client failed; pool will recover'),
    connectionString: env.AUDIT_DATABASE_URL,
    applicationName: 'alaap-clinical-vault-service',
    onDroppedContext: (keys) => log.warn({ keys }, 'audit context keys dropped'),
  });

  const clinical = new Clinical({
    records,
    consent: new ConsentClient(env.UPSTREAM_CONSENT_SERVICE, env.SERVICE_AUTH_SECRET),
    audit,
    catalogue,
    defaultPlanId: env.DEFAULT_PLAN_ID,
    log,
  });

  const app = createApp({ clinical, purge, serviceAuthSecret: env.SERVICE_AUTH_SECRET, log });

  const server = app.listen(env.PORT, () => {
    log.info(
      { port: env.PORT, env: env.NODE_ENV, key: env.CLINICAL_KEY_ID, plan: env.DEFAULT_PLAN_ID },
      'clinical-vault-service listening',
    );
  });

  const shutdown = (signal: string): void => {
    log.info({ signal }, 'shutting down');
    server.close(() => {
      void Promise.allSettled([records.close(), audit.close()]).then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('clinical-vault-service failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
