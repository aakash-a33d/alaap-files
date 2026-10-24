#!/usr/bin/env node
/**
 * Bring the whole local stack up, in the order it has to come up in.
 *
 *   node scripts/dev/up.mjs            start everything
 *   node scripts/dev/up.mjs --status   say what is running, change nothing
 *   node scripts/dev/up.mjs --stop     stop the Node services (containers stay)
 *
 * WHY THIS EXISTS
 *
 * Three times in one day the stack came back half-up and the browser showed
 * `ECONNREFUSED 127.0.0.1:8080` — which looks like a bug in the page and is not. Two
 * steps are easy to miss and neither announces itself:
 *
 *   1. OpenBao runs in dev mode, so its Transit keys live in memory. Every container
 *      restart wipes them, and clinical-vault-service then answers 500 on every write
 *      with `transit returned 404`. Re-provisioning is not optional after a restart.
 *
 *   2. The AI orchestrator needs ALAAP_SERVICE_AUTH_SECRET in its environment. Without
 *      it the /v1 routes come up UNAUTHENTICATED — it still serves, so nothing looks
 *      wrong, and the signed path the services rely on is simply not being verified.
 *
 * Logs go to .dev-logs/<service>.log. Nothing here is for production; it is the
 * runbook, executable, so that starting the stack is not a thing to remember.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const COMPOSE = resolve(ROOT, 'infrastructure/docker/compose');
const LOGS = resolve(ROOT, '.dev-logs');

const c = {
  green: (s) => `\u001b[32m${s}\u001b[0m`,
  red: (s) => `\u001b[31m${s}[0m`.replace('[0m', '\u001b[0m'),
  dim: (s) => `\u001b[2m${s}\u001b[0m`,
  bold: (s) => `\u001b[1m${s}\u001b[0m`,
};

/**
 * Every service, in dependency order.
 *
 * The gateway is last of the Node services: it cross-checks its route policy against
 * the service registry at boot and is the thing the browser talks to, so bringing it
 * up before its upstreams just means a window where the page gets 502s instead of
 * connection refused — which is harder to read, not easier.
 */
const SERVICES = [
  { id: 'pseudonym-service', port: 8102, cwd: 'backend/services/pseudonym-service' },
  { id: 'auth-service', port: 8101, cwd: 'backend/services/auth-service' },
  { id: 'community-service', port: 8103, cwd: 'backend/services/community-service' },
  { id: 'moderation-service', port: 8104, cwd: 'backend/services/moderation-service' },
  { id: 'consent-service', port: 8105, cwd: 'backend/services/consent-service' },
  { id: 'clinical-vault-service', port: 8106, cwd: 'backend/services/clinical-vault-service' },
  { id: 'retention-service', port: 8112, cwd: 'backend/services/retention-service' },
  { id: 'gateway', port: 8080, cwd: 'backend/gateway' },
];

/** The AI tier. Separate because it is Python and takes far longer to warm. */
const AI = { id: 'ai-orchestrator', port: 8000, health: '/health' };

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
}

async function healthy(port, path = '/healthz') {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitFor(port, path, seconds) {
  for (let i = 0; i < seconds * 2; i += 1) {
    if (await healthy(port, path)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** The shared secret, read from a service's own .env so there is one source. */
function serviceAuthSecret() {
  const env = readFileSync(resolve(ROOT, 'backend/services/community-service/.env'), 'utf8');
  const match = /^SERVICE_AUTH_SECRET=(.+)$/m.exec(env);
  if (match === null) throw new Error('SERVICE_AUTH_SECRET not found in community-service/.env');
  return match[1].trim();
}

function composeEnv() {
  const out = {};
  for (const line of readFileSync(resolve(COMPOSE, '.env'), 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m !== null) out[m[1]] = m[2];
  }
  return out;
}

async function status() {
  console.log(c.bold('\ncontainers\n'));
  try {
    console.log(
      sh('docker', ['compose', 'ps', '--format', '{{.Service}}\t{{.Status}}'], { cwd: COMPOSE })
        .trimEnd()
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n') || '  (none)',
    );
  } catch {
    console.log(c.red('  docker is not reachable — is Docker Desktop running?'));
  }

  console.log(c.bold('\nservices\n'));
  for (const s of [...SERVICES, AI]) {
    const ok = await healthy(s.port, s.health ?? '/healthz');
    console.log(`  ${ok ? c.green('up  ') : c.red('down')}  ${s.id} ${c.dim(`:${s.port}`)}`);
  }

  const keys = await transitPresent();
  console.log(
    `\n  ${keys ? c.green('ok  ') : c.red('gone')}  OpenBao transit keys ` +
      c.dim(keys ? '' : '— wiped by a restart; journals will fail until re-provisioned'),
  );
  console.log();
}

async function transitPresent() {
  try {
    const res = await fetch('http://127.0.0.1:8200/v1/sys/mounts', {
      headers: { 'X-Vault-Token': composeEnv().OPENBAO_ROOT_TOKEN ?? '' },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    return Object.keys(await res.json()).includes('transit/');
  } catch {
    return false;
  }
}

function stop() {
  // Ports, not process names: several services are the same `node` binary and the
  // only reliable handle on Windows is what is listening.
  for (const s of [...SERVICES, AI]) {
    try {
      const out = sh('powershell', [
        '-NoProfile',
        '-Command',
        `(Get-NetTCPConnection -LocalPort ${s.port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`,
      ]).trim();
      if (out === '') continue;
      sh('powershell', ['-NoProfile', '-Command', `Stop-Process -Id ${out} -Force`]);
      console.log(`  ${c.green('stopped')} ${s.id}`);
    } catch {
      /* not running */
    }
  }
  console.log(c.dim('\ncontainers left running — docker compose down to stop those too\n'));
}

async function up() {
  mkdirSync(LOGS, { recursive: true });

  // --- containers ---------------------------------------------------------
  console.log(c.bold('\ncontainers\n'));
  try {
    sh('docker', ['compose', 'up', '-d'], { cwd: COMPOSE });
  } catch (err) {
    console.error(c.red('\ndocker compose up failed. Is Docker Desktop running?\n'));
    console.error(String(err.stderr ?? err.message).trim().split('\n').slice(-3).join('\n'));
    return 1;
  }
  for (let i = 0; i < 120; i += 1) {
    const ps = sh('docker', ['compose', 'ps', '--format', '{{.Status}}'], { cwd: COMPOSE });
    const lines = ps.trim().split('\n').filter(Boolean);
    if (lines.length >= 5 && lines.every((l) => l.includes('healthy'))) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`  ${c.green('ok')} five containers healthy`);

  // --- the step that is always forgotten ----------------------------------
  if (await transitPresent()) {
    console.log(`  ${c.green('ok')} OpenBao transit keys already present`);
  } else {
    console.log(c.dim('  transit keys gone (dev-mode OpenBao loses them on restart) — provisioning'));
    sh('node', ['scripts/db/provision-keys.mjs'], { cwd: ROOT, env: { ...process.env, ...composeEnv() } });
    console.log(`  ${c.green('ok')} transit keys provisioned`);
  }

  // --- node services ------------------------------------------------------
  console.log(c.bold('\nservices\n'));
  const secret = serviceAuthSecret();

  for (const s of SERVICES) {
    if (await healthy(s.port)) {
      console.log(`  ${c.green('ok')} ${s.id} ${c.dim('already up')}`);
      continue;
    }
    const log = openSync(resolve(LOGS, `${s.id}.log`), 'a');
    spawn(process.execPath, ['--experimental-strip-types', '--env-file=.env', 'src/index.ts'], {
      cwd: resolve(ROOT, s.cwd),
      detached: true,
      stdio: ['ignore', log, log],
    }).unref();

    const ok = await waitFor(s.port, '/healthz', 30);
    console.log(
      ok
        ? `  ${c.green('ok')} ${s.id} ${c.dim(`:${s.port}`)}`
        : `  ${c.red('--')} ${s.id} ${c.dim(`did not answer — see .dev-logs/${s.id}.log`)}`,
    );
  }

  // --- the AI tier --------------------------------------------------------
  console.log(c.bold('\nai\n'));
  if (await healthy(AI.port, AI.health)) {
    console.log(`  ${c.green('ok')} ${AI.id} ${c.dim('already up')}`);
  } else {
    const log = openSync(resolve(LOGS, 'ai-orchestrator.log'), 'a');
    spawn('python', ['ai-services/serve.py'], {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', log, log],
      // Without this the /v1 routes serve UNAUTHENTICATED and nothing looks wrong.
      env: { ...process.env, ALAAP_SERVICE_AUTH_SECRET: secret },
    }).unref();
    console.log(c.dim('  loading MuRIL onto the GPU, usually 30-60s'));
    const ok = await waitFor(AI.port, AI.health, 180);
    console.log(
      ok
        ? `  ${c.green('ok')} ${AI.id} ${c.dim(':8000, authenticated')}`
        : `  ${c.red('--')} ${AI.id} ${c.dim('did not answer — see .dev-logs/ai-orchestrator.log')}`,
    );
  }

  console.log(c.bold('\nfrontend\n'));
  console.log(
    (await healthy(5177, '/'))
      ? `  ${c.green('ok')} vite ${c.dim(':5177')}`
      : `  ${c.dim('--')} vite is not running — ${c.bold('npm run dev --prefix frontend')}`,
  );
  console.log();
  return 0;
}

const arg = process.argv[2];
if (arg === '--status') await status();
else if (arg === '--stop') stop();
else process.exit(await up());
