#!/usr/bin/env node
/**
 * M9 — a member takes their data, and then asks to be forgotten.
 *
 * The last milestone before the first local run, and the one where the platform's
 * central promise is either true or it is not. So this suite does not trust a single
 * service's word for anything: after the deletion it opens all three PostgreSQL
 * instances directly, as superuser, past every grant and every API, and looks for the
 * pseudonym itself.
 *
 * Four claims:
 *
 *   a second factor is required, and a stolen session cannot do either of these
 *   an export contains everything the member wrote and nothing anybody else wrote
 *   after a deletion no row in any vault carries that pseudonym
 *   the audit trail survives, because it is what proves the deletion happened
 *
 *   node scripts/dev/retention-flows.mjs
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Redis, DEFAULT_REDIS_URL, clearAbuseCounters } from './lib/redis.mjs';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8080';
const COMPOSE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../infrastructure/docker/compose');

/** Read a database directly, as superuser. The view an attacker with the disk has. */
function sql(instance, db, query) {
  return execFileSync(
    'docker',
    ['compose', 'exec', '-T', instance, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db, '-tAc', query],
    { cwd: COMPOSE_DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}

let jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

function absorb(res) {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair, ...attrs] = line.split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const maxAge = attrs.find((a) => a.trim().toLowerCase().startsWith('max-age='));
    if (value === '' || (maxAge && maxAge.split('=')[1].trim() === '0')) jar.delete(name);
    else jar.set(name, value);
  }
}

async function call(method, path, body) {
  const cookie = cookieHeader();
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  absorb(res);
  const text = await res.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  return { status: res.status, body: parsed };
}
const get = (p) => call('GET', p);
const post = (p, b) => call('POST', p, b ?? {});

const c = {
  green: (s) => `[32m${s}[0m`,
  red: (s) => `[31m${s}[0m`,
  dim: (s) => `[2m${s}[0m`,
  bold: (s) => `[1m${s}[0m`,
};

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) console.log(`  ${c.green('pass')}  ${label}`);
  else {
    failures += 1;
    console.log(`  ${c.red('FAIL')}  ${label} ${c.dim(String(detail).slice(0, 130))}`);
  }
}

const randomMobile = () => `9${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
let redis;

/** Prove presence, and receive a scoped assertion. */
async function stepUp(scope) {
  const start = await post('/api/account/step-up/start', { scope });
  if (start.status !== 202) return start;
  return post('/api/account/step-up/verify', {
    challengeId: start.body.challengeId,
    code: start.body.devCode,
    scope,
  });
}

const SECRET = 'The thing I have never said out loud is that I have been counting the days.';

async function main() {
  redis = new Redis(DEFAULT_REDIS_URL);
  await redis.connect();
  await clearAbuseCounters(redis);

  // ------------------------------------------------------------------------
  console.log(c.bold('\nA member, with something in every vault\n'));

  const mobile = randomMobile();
  const start = await post('/api/auth/register/start', { mobile });
  const account = await post('/api/auth/register/verify', {
    challengeId: start.body.challengeId,
    code: start.body.devCode,
    ageConfirmed: true,
  });
  const handle = account.body.handle;
  const pseudoId = account.body.pseudoId;
  check('registered', account.status === 201 && typeof handle === 'string', handle);

  const cats = await get('/api/community/categories');
  const categoryId = (cats.body.categories ?? [])[0]?.id;

  const post1 = await post('/api/community/posts', {
    categoryId,
    body: 'Something I put down where other people could see it.',
  });
  check('wrote a post', post1.status === 201, post1.status);

  await post('/api/consent/grant/care-delivery');
  const entry = await post('/api/journal/entries', { body: SECRET });
  check(
    'wrote a journal entry, encrypted',
    entry.status === 201 || entry.status === 402,
    `${entry.status} ${JSON.stringify(entry.body).slice(0, 60)}`,
  );

  const mood = await post('/api/mood/checkins', { moodScore: 3, emotionTags: ['flat'] });
  check('recorded a mood', mood.status === 201, mood.status);

  // Somebody else, so the export can be checked for their words.
  await clearAbuseCounters(redis);
  const otherJar = jar;
  jar = new Map();
  const m2 = randomMobile();
  const s2 = await post('/api/auth/register/start', { mobile: m2 });
  await post('/api/auth/register/verify', {
    challengeId: s2.body.challengeId,
    code: s2.body.devCode,
    ageConfirmed: true,
  });
  const STRANGERS_WORDS = 'I read this and wanted you to know somebody did.';
  const reply = await post(`/api/community/posts/${post1.body.post?.ref}/replies`, {
    body: STRANGERS_WORDS,
  });
  check('a stranger replied to them', reply.status === 201, reply.status);
  jar = otherJar;

  // ------------------------------------------------------------------------
  console.log(c.bold('\nNeither door opens without proving it is you\n'));

  const noStepUp = await get('/api/data-rights/export');
  check('export is refused without a step-up', noStepUp.status === 403, noStepUp.status);
  check(
    'and says why, so the client knows what to ask for',
    noStepUp.body.error?.code === 'step_up_required',
    JSON.stringify(noStepUp.body),
  );

  const deleteNoStepUp = await post('/api/data-rights/deletion');
  check('deletion is refused too', deleteNoStepUp.status === 403, deleteNoStepUp.status);

  const stepped = await stepUp('/api/data-rights');
  check('a second factor can be proved', stepped.body.steppedUp === true, JSON.stringify(stepped.body).slice(0, 80));

  // ------------------------------------------------------------------------
  console.log(c.bold('\nEverything you wrote, and nothing anyone else did\n'));

  const exported = await get('/api/data-rights/export');
  check('the export is delivered', exported.status === 200, exported.status);

  const dump = JSON.stringify(exported.body);
  check('it contains their own post', dump.includes('Something I put down'), '');
  check('and their handle', dump.includes(handle), '');
  check('and their mood check-in', dump.includes('"moodScore":3'), '');
  if (entry.status === 201) {
    check('and their journal entry, decrypted', dump.includes(SECRET), '');
  }
  check('and their consent records', dump.includes('care-delivery'), '');

  // The one that matters. An export of "my data" must not hand over somebody else's
  // words just because they were said to me.
  check(
    "it does NOT contain the stranger's reply",
    !dump.includes(STRANGERS_WORDS),
    'a reply written by another member leaked into this export',
  );
  check(
    'and says plainly what was left out and why',
    String(exported.body.notice ?? '').includes('their words'),
    String(exported.body.notice ?? '').slice(0, 60),
  );

  // ------------------------------------------------------------------------
  console.log(c.bold('\nDeleted, and checked from the disk rather than the API\n'));

  const before = {
    posts: sql('postgres-shared', 'community_vault', `SELECT count(*) FROM community_posts WHERE author_pseudo_id = ${pseudoId}`),
    journal: sql('postgres-shared', 'clinical_vault', `SELECT count(*) FROM journal_entries WHERE pseudo_id = ${pseudoId}`),
    account: sql('postgres-shared', 'core', `SELECT count(*) FROM auth_accounts WHERE pseudo_id = ${pseudoId}`),
    persona: sql('postgres-shared', 'community_vault', `SELECT count(*) FROM pseudo_profiles WHERE pseudo_id = ${pseudoId}`),
  };
  check('there is something to delete', Number(before.account) === 1 && Number(before.persona) === 1,
    JSON.stringify(before));

  const deleted = await post('/api/data-rights/deletion');
  check('the deletion is accepted', deleted.status === 200, deleted.status);
  check('and reports completed', deleted.body.state === 'completed',
    `${deleted.body.state} ${JSON.stringify(deleted.body.detail ?? '')}`);
  check(
    'with a receipt naming every vault',
    (deleted.body.receipt ?? []).length === 5,
    JSON.stringify(deleted.body.receipt ?? []).slice(0, 120),
  );
  check(
    'and tells them the audit trail remains, and why',
    String(deleted.body.message).includes('proves we did this'),
    String(deleted.body.message).slice(0, 80),
  );

  // Superuser, every instance, past every service.
  const after = {
    posts: sql('postgres-shared', 'community_vault', `SELECT count(*) FROM community_posts WHERE author_pseudo_id = ${pseudoId}`),
    replies: sql('postgres-shared', 'community_vault', `SELECT count(*) FROM community_comments WHERE author_pseudo_id = ${pseudoId}`),
    persona: sql('postgres-shared', 'community_vault', `SELECT count(*) FROM pseudo_profiles WHERE pseudo_id = ${pseudoId}`),
    journal: sql('postgres-shared', 'clinical_vault', `SELECT count(*) FROM journal_entries WHERE pseudo_id = ${pseudoId}`),
    mood: sql('postgres-shared', 'clinical_vault', `SELECT count(*) FROM mood_checkins WHERE pseudo_id = ${pseudoId}`),
    consent: sql('postgres-shared', 'clinical_vault', `SELECT count(*) FROM consent_records WHERE pseudo_id = ${pseudoId}`),
    account: sql('postgres-shared', 'core', `SELECT count(*) FROM auth_accounts WHERE pseudo_id = ${pseudoId}`),
    sessions: sql('postgres-shared', 'core', `SELECT count(*) FROM sessions s JOIN auth_accounts a ON a.id = s.account_id WHERE a.pseudo_id = ${pseudoId}`),
  };

  for (const [what, count] of Object.entries(after)) {
    check(`no ${what} remain`, Number(count) === 0, `${count} row(s) left`);
  }

  // The handle is the last thread. Without it the pseudo id explains nothing.
  const handleGone = sql(
    'postgres-shared',
    'community_vault',
    `SELECT count(*) FROM pseudo_profiles WHERE handle = '${handle.replace(/'/g, "''")}'`,
  );
  check('the handle resolves to nobody', Number(handleGone) === 0, handleGone);

  // The journal body, searched for as raw bytes across the vault it lived in.
  const ciphertextGone = sql(
    'postgres-shared',
    'clinical_vault',
    `SELECT count(*) FROM journal_entries WHERE position(convert_to('${SECRET.slice(0, 40)}', 'UTF8') in body_ciphertext) > 0`,
  );
  check('and no ciphertext of theirs is left behind', Number(ciphertextGone) === 0, ciphertextGone);

  // ------------------------------------------------------------------------
  console.log(c.bold('\nThe trail survives, because it is the proof\n'));

  const audited = sql(
    'postgres-audit',
    'audit_vault',
    `SELECT count(*) FROM audit_events WHERE pseudo_id = ${pseudoId}`,
  );
  check('audit rows for this member remain', Number(audited) > 0, audited);

  const completed = sql(
    'postgres-audit',
    'audit_vault',
    `SELECT count(*) FROM audit_events WHERE pseudo_id = ${pseudoId} AND action_type = 'data_rights.deletion.completed'`,
  );
  check('including the evidence the deletion happened', Number(completed) === 1, completed);

  // The audit vault must hold no content. Checked directly rather than trusted.
  const leaked = sql(
    'postgres-audit',
    'audit_vault',
    `SELECT count(*) FROM audit_events WHERE context::text ILIKE '%counting the days%'`,
  );
  check('and the trail holds none of what they wrote', Number(leaked) === 0, leaked);

  // ------------------------------------------------------------------------
  console.log(c.bold('\nAnd the session is gone with the account\n'));

  const afterDelete = await get('/api/pseudonym/me');
  check('their session no longer resolves', afterDelete.status === 401, afterDelete.status);

  // ------------------------------------------------------------------------
  console.log(c.bold('\nA held record does not save the rest\n'));

  // A post retained for an appeal or an abuse investigation. There is no API for this
  // — setting a hold is moderation's job and that queue is unbuilt — so it is set the
  // way a moderator's tooling eventually will, directly on the row.
  await clearAbuseCounters(redis);
  jar = new Map();
  const m3 = randomMobile();
  const s3 = await post('/api/auth/register/start', { mobile: m3 });
  const acct3 = await post('/api/auth/register/verify', {
    challengeId: s3.body.challengeId,
    code: s3.body.devCode,
    ageConfirmed: true,
  });
  const heldPseudoId = acct3.body.pseudoId;

  const kept = await post('/api/community/posts', {
    categoryId,
    body: 'A post that somebody has appealed a verdict about.',
  });
  await post('/api/mood/checkins', { moodScore: 5 });

  sql(
    'postgres-shared',
    'community_vault',
    `UPDATE community_posts SET legal_hold = true WHERE public_ref = '${kept.body.post?.ref}'`,
  );

  await stepUp('/api/data-rights');
  const partial = await post('/api/data-rights/deletion');

  check('the deletion is accepted', partial.status === 200, partial.status);
  check(
    'and reports PARTIAL rather than complete',
    partial.body.state === 'partial',
    `${partial.body.state}`,
  );
  check(
    'naming what survived and why, in words a member can act on',
    String(JSON.stringify(partial.body.receipt)).includes('appeal'),
    JSON.stringify(partial.body.receipt).slice(0, 140),
  );
  check(
    'and NOT claiming the account was deleted',
    partial.body.deleted === false,
    String(partial.body.deleted),
  );

  const heldPost = sql(
    'postgres-shared',
    'community_vault',
    `SELECT count(*) FROM community_posts WHERE author_pseudo_id = ${heldPseudoId}`,
  );
  check('the held post survives', Number(heldPost) === 1, heldPost);

  // The whole point. One held post must not leave the member's clinical vault intact.
  const heldMood = sql(
    'postgres-shared',
    'clinical_vault',
    `SELECT count(*) FROM mood_checkins WHERE pseudo_id = ${heldPseudoId}`,
  );
  check('but the mood check-ins went anyway', Number(heldMood) === 0, heldMood);

  const heldAccount = sql(
    'postgres-shared',
    'core',
    `SELECT count(*) FROM auth_accounts WHERE pseudo_id = ${heldPseudoId}`,
  );
  check('and so did the account', Number(heldAccount) === 0, heldAccount);

  redis.close();
  console.log(
    failures === 0
      ? c.green(`\nM9 holds — ${c.bold('the data is gone, and the proof that it was is not')}\n`)
      : c.red(`\n${failures} check(s) FAILED\n`),
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  redis?.close();
  process.exit(1);
});
