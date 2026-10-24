#!/usr/bin/env node
/**
 * Provision OpenBao Transit: the key-encryption keys the vaults wrap their DEKs with.
 *
 *   node scripts/db/provision-keys.mjs           create anything missing
 *   node scripts/db/provision-keys.mjs --status  show what exists, change nothing
 *   node scripts/db/provision-keys.mjs --rotate <name>
 *
 * WHAT TRANSIT IS AND IS NOT DOING
 *
 * It never sees a journal entry. Each record gets its own random data key (DEK), the
 * body is encrypted locally with that DEK, and only the DEK is sent here to be
 * wrapped. So a compromise of OpenBao yields wrapped keys and no content, and a
 * compromise of the database yields ciphertext and wrapped keys it cannot unwrap.
 * Both are needed to read anything, which is the entire point of the arrangement.
 *
 * WHY A KEY PER VAULT AND NOT ONE FOR EVERYTHING
 *
 * The blast radius of a key is every record it wraps. Separate keys mean a rotation,
 * a compromise or a legal hold on clinical content does not touch billing, and a
 * service holding one key cannot read another vault's records even if it reached them.
 *
 * `deletion_allowed` stays FALSE. Deleting a key destroys every record it wraps,
 * instantly and irreversibly, with no way to tell which ones they were — that is a
 * data-loss event wearing the costume of a cleanup command.
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPOSE_DIR = resolve(HERE, '../..', 'infrastructure/docker/compose');

/**
 * One key per vault that holds encrypted payloads.
 *
 * aes256-gcm96 throughout: authenticated, and the same primitive the services use for
 * the payload itself, so there is one algorithm to reason about rather than two.
 */
const KEYS = [
  {
    name: 'alaap-clinical',
    note: 'Journals, short stories, mood notes. The most sensitive content on the platform.',
  },
  {
    name: 'alaap-identity',
    note: 'Real names, verified numbers, emergency contacts. Separate instance, separate key.',
  },
  {
    name: 'alaap-billing',
    note: 'Payment references. Lower sensitivity, still not shared with clinical.',
  },
];

const c = {
  dim: (s) => `[2m${s}[0m`,
  red: (s) => `[31m${s}[0m`,
  green: (s) => `[32m${s}[0m`,
  yellow: (s) => `[33m${s}[0m`,
  bold: (s) => `[1m${s}[0m`,
};

function bao(args, { allowFailure = false } = {}) {
  try {
    return execFileSync(
      'docker',
      ['compose', 'exec', '-T', 'openbao', 'bao', ...args],
      {
        cwd: COMPOSE_DIR,
        encoding: 'utf8',
        env: {
          ...process.env,
          BAO_ADDR: 'http://127.0.0.1:8200',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (err) {
    if (allowFailure) return '';
    const detail = (err.stderr || err.stdout || err.message).toString().trim();
    console.error(`\n${c.red('bao failed')} ${args.join(' ')}\n${c.dim(detail)}\n`);
    process.exit(1);
  }
}

const token = process.env.OPENBAO_ROOT_TOKEN;
if (!token) {
  console.error(
    `\n${c.red('missing')} OPENBAO_ROOT_TOKEN — set it in infrastructure/docker/compose/.env\n`,
  );
  process.exit(1);
}
// Address and token go in as environment rather than flags: `bao` only accepts
// -address AFTER the subcommand, and passing the token per-command keeps it out of the
// image and out of any shell history on the host.
function withToken(args) {
  return execFileSync(
    'docker',
    [
      'compose', 'exec', '-T',
      '-e', `BAO_TOKEN=${token}`,
      '-e', 'BAO_ADDR=http://127.0.0.1:8200',
      'openbao', 'bao', ...args,
    ],
    { cwd: COMPOSE_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function tryWithToken(args) {
  try {
    return withToken(args);
  } catch (err) {
    return { failed: true, detail: (err.stderr || err.stdout || '').toString() };
  }
}

const status = process.argv.includes('--status');
const rotateIndex = process.argv.indexOf('--rotate');

console.log('');

// --- mount ------------------------------------------------------------------
const mounts = tryWithToken(['secrets', 'list', '-format=json']);
const mounted = typeof mounts === 'string' && mounts.includes('"transit/"');

if (!mounted) {
  if (status) {
    console.log(`  ${c.yellow('absent')} transit is not mounted`);
  } else {
    const out = tryWithToken(['secrets', 'enable', 'transit']);
    if (out.failed && !out.detail.includes('path is already in use')) {
      console.error(`\n${c.red('could not mount transit')}\n${c.dim(out.detail)}\n`);
      process.exit(1);
    }
    console.log(`  ${c.green('mount ')} transit enabled`);
  }
} else {
  console.log(`  ${c.dim('mount ')} transit already enabled`);
}

// --- rotation ---------------------------------------------------------------
//
// A rotation adds a NEW version and keeps the old ones. Records wrapped by version 3
// stay readable after a rotation to version 4 — which is why every row stores
// `key_version` beside its ciphertext. Nothing is re-encrypted, and nothing needs to be.
if (rotateIndex !== -1) {
  const name = process.argv[rotateIndex + 1];
  if (!name || !KEYS.some((k) => k.name === name)) {
    console.error(`\n${c.red('--rotate')} needs one of: ${KEYS.map((k) => k.name).join(', ')}\n`);
    process.exit(1);
  }
  tryWithToken(['write', '-f', `transit/keys/${name}/rotate`]);
  const after = tryWithToken(['read', '-format=json', `transit/keys/${name}`]);
  const version = JSON.parse(after).data.latest_version;
  console.log(`  ${c.green('rotate')} ${name} is now at version ${version}`);
  console.log(
    c.dim(
      '\n  Existing records keep their key_version and stay readable. Nothing is\n' +
        '  re-encrypted — that is what storing the version per row buys.\n',
    ),
  );
  process.exit(0);
}

// --- keys -------------------------------------------------------------------
let created = 0;
for (const key of KEYS) {
  const existing = tryWithToken(['read', '-format=json', `transit/keys/${key.name}`]);
  if (typeof existing === 'string') {
    const version = JSON.parse(existing).data.latest_version;
    console.log(`  ${c.dim('key   ')} ${key.name} ${c.dim(`exists, version ${version}`)}`);
    continue;
  }
  if (status) {
    console.log(`  ${c.yellow('absent')} ${key.name}`);
    continue;
  }

  const out = tryWithToken(['write', '-f', `transit/keys/${key.name}`, 'type=aes256-gcm96']);
  if (out.failed) {
    console.error(`\n${c.red('could not create')} ${key.name}\n${c.dim(out.detail)}\n`);
    process.exit(1);
  }

  // Deleting a key destroys every record it wraps, with no way to tell which. Refusing
  // it here means the destructive path needs a deliberate config change first.
  tryWithToken(['write', `transit/keys/${key.name}/config`, 'deletion_allowed=false']);
  console.log(`  ${c.green('key   ')} ${key.name} ${c.dim('created, deletion disabled')}`);
  created += 1;
}

console.log('');
if (status) {
  console.log(c.dim('  --status only. Nothing was changed.\n'));
} else {
  console.log(
    `${c.green('done')} — ${created} key(s) created, ${KEYS.length - created} already present\n`,
  );
}
