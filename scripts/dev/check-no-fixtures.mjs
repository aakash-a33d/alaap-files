#!/usr/bin/env node
/**
 * No screen renders invented data.
 *
 * M8's acceptance condition is "the browser talks to the backend; no mock data
 * anywhere", and that is a condition which decays silently. A fixture reintroduced
 * during a refactor looks exactly like working software — better than working
 * software, because it never has an empty state, never fails, and always has a
 * plausible handle in it.
 *
 * COPY IS NOT A FIXTURE
 *
 * `src/content/` legitimately holds the product's voice: placeholders, blurbs, labels,
 * the names of categories. Those are written by us and are the same for every member.
 * What may not live there is anything asserting a fact about a person or their data —
 * a handle, a mood history, a thread somebody wrote, a plan somebody is on.
 *
 * The difference is not one a regex can see, so the rule is by NAME: the exports
 * listed below are fixtures, and a component importing one fails this gate.
 *
 *   node scripts/dev/check-no-fixtures.mjs
 */

import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = resolve(ROOT, 'frontend/src');

const c = {
  green: (s) => `\u001b[32m${s}\u001b[0m`,
  red: (s) => `\u001b[31m${s}\u001b[0m`,
  dim: (s) => `\u001b[2m${s}\u001b[0m`,
};

/**
 * Exports that assert something about a person rather than saying something in the
 * product's voice. Each is a claim the server is the only honest source for.
 */
const FIXTURES = [
  ['MEMBER', 'a handle and a plan belong to somebody — /api/pseudonym/me'],
  ['SEAM_DAYS', 'fourteen days of mood history nobody lived — /api/mood/checkins'],
  ['THREADS', 'posts and replies somebody wrote — /api/community/feed'],
  ['myPosts', "the member's own posts — /api/community/posts/mine"],
  ['CATEGORIES', 'the topic list — /api/community/categories, whose words are the decision'],
  ['ENTRIES', 'journal entries — /api/journal/entries'],
  ['CHECKINS', 'mood check-ins — /api/mood/checkins'],
  ['CONSENTS', 'consent records — /api/consent/records'],
];

/**
 * Illustrations, and the only place they are allowed.
 *
 * The public pages show examples we wrote, because real members' words are not
 * marketing material and the feed is not readable without a session. Those pages
 * say so on the page itself. Everywhere else — anything behind a session — must
 * render what the server returned.
 */
const ILLUSTRATIVE = /^ILLUSTRATIVE_/;

/**
 * Listed one by one rather than by directory.
 *
 * A directory rule quietly grants the exemption to whatever gets added there
 * later. These two are public marketing surfaces that carry a visible notice
 * saying the posts are written examples; adding a third should require somebody
 * to think about whether it carries that notice too.
 */
const ILLUSTRATION_PAGES = new Set([
  'frontend/src/pages/public/sections/LivePosts.tsx',
  'frontend/src/pages/community/Community.tsx',
]);

/** Where a fixture may still be defined, while the screens are being wired. */
const CONTENT = /^frontend\/src\/content\//;

const files = globSync('frontend/src/**/*.{ts,tsx}', { cwd: ROOT })
  .filter((f) => !f.includes('node_modules'))
  .map((f) => f.split('\\').join('/'));

let failures = 0;

for (const file of files) {
  if (CONTENT.test(file)) continue; // definitions are checked by their importers
  const text = readFileSync(resolve(ROOT, file), 'utf8');

  // Illustrative content, outside the pages allowed to show it.
  if (!ILLUSTRATION_PAGES.has(file)) {
    for (const match of text.matchAll(/import\s*\{([^}]*)\}/gm)) {
      for (const spec of match[1].split(',')) {
        const name = spec.trim().split(/\s+as\s+/)[0].trim();
        if (!ILLUSTRATIVE.test(name)) continue;
        failures += 1;
        console.log(`  ${c.red('ILLUSTRATION')} ${relative('.', file)}  imports ${name}`);
        console.log(`          ${c.dim('examples belong on the public pages, which label them as such')}`);
      }
    }
  }

  for (const [name, why] of FIXTURES) {
    // An import of the name from anywhere, in either import style.
    const imported =
      new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`, 'm').test(text) ||
      new RegExp(`\\b${name}\\b\\s*=\\s*require\\(`, 'm').test(text);
    if (!imported) continue;

    failures += 1;
    console.log(`  ${c.red('FIXTURE')} ${relative('.', file)}  imports ${name}`);
    console.log(`          ${c.dim(why)}`);
  }
}

console.log(
  failures === 0
    ? c.green(`\nno component renders fixture data — ${files.length} files checked\n`)
    : c.red(`\n${failures} import(s) of invented data\n`),
);
process.exit(failures === 0 ? 0 : 1);
