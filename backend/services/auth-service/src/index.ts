/**
 * auth-service entry point.
 *
 * Sole holder of credentials to `core`: accounts, passkeys, recovery codes, trusted
 * devices, sessions, login events. It writes sessions that the gateway reads, through
 * @alaap/session-store so the two cannot disagree about the record shape.
 */

import { Redis } from 'ioredis';
import { pino } from 'pino';
import { PostgresAuditClient } from '@alaap/audit-client';
import { SessionStore } from '@alaap/session-store';

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './api/app.ts';
import { Devices } from './application/devices.ts';
import { Registration } from './application/register.ts';
import { loadDeviceLabels } from './config/device-labels.ts';
import { loadEnv } from './config/env.ts';
import { DeviceRepository } from './infrastructure/devices.ts';
import { AccountRepository, createCorePool } from './infrastructure/accounts.ts';
import { CredentialRepository } from './infrastructure/credentials.ts';
import { WebAuthnChallengeStore } from './infrastructure/webauthn-challenges.ts';
import { Login } from './application/login.ts';
import { Passkeys } from './application/passkeys.ts';
import { ChallengeStore } from './infrastructure/challenges.ts';
import { PseudonymClient } from './infrastructure/pseudonym-client.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** src/ -> service root -> services -> backend -> repository root */
const DEFAULT_ROOT = resolve(HERE, '../../../..');

async function main(): Promise<void> {
  const env = loadEnv();
  const log = pino({
    level: env.LOG_LEVEL,
    base: { service: 'auth-service' },
    // §12P: an OTP or a token in a log line is a live credential. The registration
    // flow logs the dev code deliberately and nothing else, so this list is the
    // backstop rather than the policy.
    redact: {
      paths: ['*.token', '*.code', '*.mobile', '*.otp', '*.recoveryCodes', 'req.headers'],
      censor: '[redacted]',
    },
  });

  if (env.OTP_TRANSPORT === 'log') {
    log.warn({}, 'OTP transport is `log` — codes appear in this stream, development only');
  }

  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
  });
  redis.on('error', (err) => log.error({ err: err.message }, 'redis error'));

  const corePool = createCorePool(env.CORE_DATABASE_URL, log);
  const accounts = new AccountRepository(corePool);
  const credentials = new CredentialRepository(corePool);
  const audit = new PostgresAuditClient({
    onPoolError: (err) =>
      log.error({ err: err.message }, 'idle audit-vault client failed; pool will recover'),
    connectionString: env.AUDIT_DATABASE_URL,
    applicationName: 'alaap-auth-service',
    onDroppedContext: (keys) => log.warn({ dropped: keys }, 'audit context keys dropped'),
  });

  // One SessionStore, shared. Three separate instances would each hold their own
  // Redis handle for the same keyspace, and device revocation has to see the sessions
  // the sign-in paths minted.
  const sessions = new SessionStore(redis);

  const devices = new Devices({
    devices: new DeviceRepository(corePool),
    accounts,
    sessions,
    audit,
    labels: loadDeviceLabels(env.METADATA_ROOT ?? DEFAULT_ROOT),
    devicePepper: env.DEVICE_PEPPER,
    log,
  });

  const registration = new Registration({
    devices,
    accounts,
    challenges: new ChallengeStore(redis),
    sessions,
    pseudonyms: new PseudonymClient(env.UPSTREAM_PSEUDONYM_SERVICE, env.SERVICE_AUTH_SECRET),
    audit,
    mobilePepper: env.MOBILE_PEPPER,
    otpPepper: env.OTP_PEPPER,
    otpTransport: env.OTP_TRANSPORT,
    log,
  });

  const passkeys = new Passkeys({
    devices,
    accounts,
    credentials,
    challenges: new WebAuthnChallengeStore(redis),
    sessions,
    pseudonyms: new PseudonymClient(env.UPSTREAM_PSEUDONYM_SERVICE, env.SERVICE_AUTH_SECRET),
    audit,
    rpName: env.RP_NAME,
    rpId: env.RP_ID,
    expectedOrigin: env.EXPECTED_ORIGIN,
    log,
  });

  const login = new Login({
    devices,
    accounts,
    challenges: new ChallengeStore(redis),
    sessions,
    pseudonyms: new PseudonymClient(env.UPSTREAM_PSEUDONYM_SERVICE, env.SERVICE_AUTH_SECRET),
    audit,
    mobilePepper: env.MOBILE_PEPPER,
    otpPepper: env.OTP_PEPPER,
    otpTransport: env.OTP_TRANSPORT,
    log,
  });

  const app = createApp({
    registration,
    passkeys,
    login,
    devices,
    accounts,
    sessions,
    serviceAuthSecret: env.SERVICE_AUTH_SECRET,
    log,
  });

  const server = app.listen(env.PORT, () => {
    log.info({ port: env.PORT, env: env.NODE_ENV }, 'auth-service listening');
  });

  const shutdown = (signal: string): void => {
    log.info({ signal }, 'shutting down');
    server.close(() => {
      void Promise.allSettled([corePool.end(), audit.close(), redis.quit()]).then(() =>
        process.exit(0),
      );
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('auth-service failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
