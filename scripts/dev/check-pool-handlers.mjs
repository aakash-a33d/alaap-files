#!/usr/bin/env node
/**
 * Every pg Pool must listen for 'error'.
 *
 * A Pool with no 'error' listener is a service that exits, uncaught, whenever Postgres
 * restarts — because `pg` re-emits an idle client's failure on the Pool, and in Node an
 * unlistened 'error' event is an uncaught exception rather than a logged warning. It
 * killed community-service twice before anyone noticed, and which service dies is
 * decided by which happened to be holding an idle connection at that instant.
 *
 * That randomness is why this is a gate rather than a code review note. Seventeen
 * services are planned; ten are not written yet. The failure is silent, severe, and
 * exactly the kind that gets reintroduced by someone copying an existing file.
 *
 *   node scripts/dev/check-pool-handlers.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const c = {
  green: (s) => `[32m${s}[0m`,
  red: (s) => `[31m${s}[0m`,
  dim: (s) => `[2m${s}[0m`,
  bold: (s) => `[1m${s}[0m`,
};

/** How far after `new Pool(` to look for the listener. Generous; the pool literal is short. */
const WINDOW = 25;

const files = globSync('{backend,packages}/**/*.ts', { cwd: ROOT })
  .filter((f) => !f.includes('node_modules') && !f.includes('/dist/'));

let failures = 0;
let checked = 0;

for (const file of files) {
  const abs = resolve(ROOT, file);
  const lines = readFileSync(abs, 'utf8').split('\n');

  lines.forEach((line, i) => {
    if (!line.includes('new Pool(')) return;
    checked += 1;

    const after = lines.slice(i, i + WINDOW).join('\n');
    // The listener may be attached to `pool`, `this.pool`, or whatever the binding is
    // called, so match the call rather than the receiver.
    if (/\.on\(\s*['"]error['"]/.test(after)) return;

    failures += 1;
    console.log(
      `  ${c.red('MISSING')} ${relative('.', file)}:${i + 1}  ${c.dim("no .on('error') within " + WINDOW + ' lines')}`,
    );
  });
}

console.log(
  failures === 0
    ? c.green(`\nall ${checked} pg Pool(s) listen for 'error'\n`)
    : c.red(`\n${failures} of ${checked} pool(s) would crash the process on a database restart\n`),
);
process.exit(failures === 0 ? 0 : 1);
