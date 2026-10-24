#!/usr/bin/env node
/**
 * Mint a development session directly into Redis.
 *
 * auth-service does not exist until M3, but the gateway needs a resolvable session to
 * exercise stages 3 through 9. This writes the same record shape auth-service will,
 * so anything that works against this will work against the real thing.
 *
 * DEVELOPMENT ONLY. It fabricates an authenticated session from nothing, which is
 * exactly what an attacker would want to do. It refuses to run outside development
 * and it lives in scripts/dev/ rather than anywhere a deployment could reach.
 *
 *   node scripts/dev/mint-session.mjs                    a plain user
 *   node scripts/dev/mint-session.mjs --role admin       another role
 *   node scripts/dev/mint-session.mjs --step-up /api/admin   with a step-up assertion
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPOSE_DIR = resolve(HERE, '../../infrastructure/docker/compose');

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to mint a session in production');
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const role = flag('--role', 'user');
const stepUpScope = flag('--step-up', undefined);
const ttlSeconds = Number(flag('--ttl', '1800'));

const VALID_ROLES = ['user', 'therapist', 'moderator', 'admin', 'safety_reviewer', 'partner'];
if (!VALID_ROLES.includes(role)) {
  console.error(`--role must be one of: ${VALID_ROLES.join(', ')}`);
  process.exit(1);
}

// Opaque and high-entropy, exactly as auth-service will mint it. The token itself is
// never stored — Redis is keyed by its SHA-256.
const token = `alaap_dev_${randomBytes(32).toString('base64url')}`;
const key = `session:${createHash('sha256').update(token, 'utf8').digest('hex')}`;

const now = Date.now();
const record = {
  sessionId: randomUUID(),
  accountId: randomUUID(),
  // The join key across vaults. Never a legal identity.
  pseudoId: Number(flag('--pseudo-id', '847291')),
  actorRole: role,
  createdAt: new Date(now).toISOString(),
  lastActiveAt: new Date(now).toISOString(),
  expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
  absoluteExpiresAt: new Date(now + 24 * 3600 * 1000).toISOString(),
  ...(stepUpScope !== undefined
    ? { steppedUpAt: new Date(now).toISOString(), steppedUpScope: stepUpScope }
    : {}),
};

const password = process.env.REDIS_PASSWORD;
if (!password) {
  console.error('REDIS_PASSWORD is not set — source infrastructure/docker/compose/.env first');
  process.exit(1);
}

execFileSync(
  'docker',
  [
    'compose', 'exec', '-T', 'redis',
    'redis-cli', '-a', password, '--no-auth-warning',
    'SET', key, JSON.stringify(record), 'EX', String(ttlSeconds),
  ],
  { cwd: COMPOSE_DIR, stdio: ['pipe', 'pipe', 'inherit'] },
);

console.log(`\nrole       ${record.actorRole}`);
console.log(`pseudo_id  ${record.pseudoId}`);
console.log(`step-up    ${stepUpScope ?? '(none)'}`);
console.log(`expires    ${ttlSeconds}s\n`);
console.log(token);
console.log('');
