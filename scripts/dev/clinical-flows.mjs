#!/usr/bin/env node
/**
 * M7 — a journal entry written, encrypted, read back, and its consent withdrawn.
 *
 * The milestone's own acceptance test, plus the two claims that make it worth having:
 *
 *   the database holds no plaintext, ever
 *   withdrawing consent stops new processing and destroys nothing already written
 *
 * The second is the one members will actually test, usually at the worst moment, and
 * getting it wrong in either direction is serious. Leaving processing running is a
 * broken promise. Deleting somebody's words because they asked us to stop reading them
 * is a catastrophe.
 *
 *   node scripts/dev/clinical-flows.mjs
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Redis, DEFAULT_REDIS_URL, clearAbuseCounters } from './lib/redis.mjs';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8080';
const COMPOSE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../infrastructure/docker/compose');

/**
 * Read the clinical vault directly, as the superuser, bypassing every service.
 *
 * The API cannot prove the at-rest claim. Asking the service whether it encrypted
 * something is asking the only party with a reason to say yes. This looks at the bytes
 * on disk the way a stolen backup or a subpoenaed volume would.
 */
function sql(query) {
  return execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres-shared',
      'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'clinical_vault', '-tAc', query],
    { cwd: COMPOSE_DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}

async function call(method, path, body, token) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(method === 'GET' || method === 'DELETE' ? {} : { body: JSON.stringify(body ?? {}) }),
  });
  const text = await res.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  return { status: res.status, body: parsed };
}
const post = (p, b, t) => call('POST', p, b, t);
const get = (p, t) => call('GET', p, undefined, t);
const del = (p, t) => call('DELETE', p, undefined, t);

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
    console.log(`  ${c.red('FAIL')}  ${label} ${c.dim(detail)}`);
  }
}

const randomMobile = () => `9${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
let redis;

async function enrol() {
  await clearAbuseCounters(redis);
  const mobile = randomMobile();
  const s = await post('/api/auth/register/start', { mobile });
  const v = await post('/api/auth/register/verify', {
    challengeId: s.body.challengeId,
    code: s.body.devCode,
    ageConfirmed: true,
  });
  return v.body.token;
}

const SECRET = 'The thing I have not told anyone is that I stopped going in three weeks ago.';

async function main() {
  redis = new Redis(DEFAULT_REDIS_URL);
  await redis.connect();
  await clearAbuseCounters(redis);

  const token = await enrol();
  check('registered a member', typeof token === 'string');

  // ------------------------------------------------------------------------
  console.log(c.bold('\nConsent comes before the content\n'));

  const before = await post('/api/journal/entries', { body: SECRET }, token);
  check('writing without consent is refused', before.status === 451, String(before.status));
  check(
    'and says so, rather than blaming a quota',
    before.body.error?.code === 'consent_withdrawn',
    JSON.stringify(before.body),
  );

  const granted = await post('/api/consent/grant/care-delivery', {}, token);
  check('consent can be granted', granted.status === 201, JSON.stringify(granted.body).slice(0, 90));
  check(
    'and points at the text that was agreed to',
    typeof granted.body.record?.versionId === 'string',
    String(granted.body.record?.versionId),
  );

  const unknown = await post('/api/consent/grant/selling-your-data', {}, token);
  check('an unregistered purpose cannot be consented to', unknown.status === 422, String(unknown.status));

  // ------------------------------------------------------------------------
  console.log(c.bold('\nWritten, encrypted, read back\n'));

  const written = await post('/api/journal/entries', { body: SECRET }, token);
  check('the entry is written', written.status === 201, JSON.stringify(written.body).slice(0, 90));
  const id = written.body.entry?.id;
  check(
    'with a word count, and no title field — a title is content',
    written.body.entry?.wordCount > 0 && !('title' in (written.body.entry ?? {})),
  );

  const readBack = await get(`/api/journal/entries/${id}`, token);
  check('it reads back byte for byte', readBack.body.entry?.body === SECRET,
    String(readBack.body.entry?.body).slice(0, 60));
  check('under standard privacy mode', readBack.body.entry?.privacyMode === 'standard');

  const list = await get('/api/journal/entries', token);
  check('the list shows it', (list.body.entries ?? []).length === 1,
    String((list.body.entries ?? []).length));
  check(
    'WITHOUT decrypting anything — no body in a list view',
    (list.body.entries ?? []).every((e) => !('body' in e)),
    JSON.stringify(list.body.entries?.[0] ?? {}),
  );

  const stranger = await enrol();
  const notYours = await get(`/api/journal/entries/${id}`, stranger);
  check('another member cannot read it', notYours.status === 404, String(notYours.status));

  const malformed = await get('/api/journal/entries/not-a-uuid', token);
  check('a malformed id is a 404, not a 500', malformed.status === 404, String(malformed.status));

  // ------------------------------------------------------------------------
  console.log(c.bold('\nAnd on disk there is nothing to read\n'));
  //
  // Read as the superuser, past every service and every grant. This is the view an
  // attacker with the volume has, and the one claim that cannot be demonstrated
  // through an API that would have to vouch for itself.

  const distinctive = 'stopped going in three weeks ago';

  // A BYTE search, not a text one. The column is bytea, and casting it to text renders
  // it as hex — against which any ILIKE for readable words passes trivially and proves
  // nothing. position(bytea in bytea) asks the real question: do these bytes occur.
  const leaked = sql(`
    SELECT count(*) FROM journal_entries
    WHERE position(convert_to('${distinctive}', 'UTF8') in body_ciphertext) > 0`);
  check('the entry body is nowhere in the ciphertext', leaked === '0', leaked);

  // Every text-typed column of the row, whatever it is called. Written against the
  // catalogue rather than a list of columns so that a future migration adding a
  // `preview` or `title` column is caught by this test rather than by a breach.
  const anywhere = sql(`
    SELECT count(*) FROM journal_entries e
    WHERE to_jsonb(e)::text ILIKE '%${distinctive}%'`);
  check(
    'nor in any text column of the row — no stray copy, no denormalised preview',
    anywhere === '0',
    anywhere,
  );

  const dek = sql(`SELECT count(*) FROM journal_entries WHERE body_dek IS NULL OR length(body_dek) = 0`);
  check('every row carries a wrapped key of its own', dek === '0', dek);

  const keys = sql(`SELECT count(DISTINCT body_dek) = count(*) FROM journal_entries`);
  check('and no two rows share one — a DEK per record, not per member', keys === 't', keys);

  const wrapped = sql(`
    SELECT count(*) FROM journal_entries
    WHERE encode(body_dek, 'escape') NOT LIKE 'vault:v%'`);
  check(
    'the stored key is a Transit wrapper, not a key we could use ourselves',
    wrapped === '0',
    wrapped,
  );

  // The mood table is deliberately NOT encrypted: a 1-10 integer has too little
  // entropy for encryption to hide anything, and pretending otherwise would buy a
  // KMS call per read for no privacy. Asserted so the choice stays a decision.
  const moodPlain = sql(`SELECT count(*) FROM mood_checkins WHERE mood_score IS NOT NULL`);
  check('mood scores are stored in the clear, on purpose', Number(moodPlain) > 0, moodPlain);

  // ------------------------------------------------------------------------
  console.log(c.bold('\nMood is never gated\n'));

  const mood = await post('/api/mood/checkins', { moodScore: 3, emotionTags: ['flat'] }, token);
  check('a mood check-in is recorded', mood.status === 201, String(mood.status));

  const moodNoConsent = await post('/api/mood/checkins', { moodScore: 5 }, stranger);
  check(
    'and works for a member who granted no consent at all',
    moodNoConsent.status === 201,
    String(moodNoConsent.status),
  );

  await post('/api/mood/checkins', { moodScore: 6 }, token);
  const history = await get('/api/mood/checkins?days=7', token);
  check('the same day replaces rather than duplicates', (history.body.checkins ?? []).length === 1,
    String((history.body.checkins ?? []).length));
  check('with the latest value', history.body.checkins?.[0]?.moodScore === 6,
    String(history.body.checkins?.[0]?.moodScore));

  /* Every end of every control, because the dashboard shipped for four milestones
     sending the lowest mood step as 0 — one below what the API accepts — so the
     member having the heaviest day got a 400 and "that could not be saved just now".
     A scale the interface can reach and the vault refuses is the one failure mode
     worth a standing check, and it is invisible from either side alone. */
  const ends = [
    ['the lowest mood step', { moodScore: 1 }],
    ['the highest mood step', { moodScore: 7 }],
    ['no sleep at all', { moodScore: 4, sleepHours: 0 }],
    ['the longest night the stepper allows', { moodScore: 4, sleepHours: 12 }],
    ['the calmest day', { moodScore: 4, stressScore: 1 }],
    ['the heaviest day', { moodScore: 4, stressScore: 10 }],
  ];
  for (const [what, body] of ends) {
    const r = await post('/api/mood/checkins', body, token);
    check(`${what} is accepted`, r.status === 201, String(r.status));
  }

  const stressBack = await get('/api/mood/checkins?days=7', token);
  check('and stress comes back with the check-in',
    stressBack.body.checkins?.[0]?.stressScore === 10,
    String(stressBack.body.checkins?.[0]?.stressScore));

  // ------------------------------------------------------------------------
  console.log(c.bold('\nWithdrawal stops processing and destroys nothing\n'));

  const withdrawn = await post('/api/consent/withdraw/care-delivery', {}, token);
  check('consent can be withdrawn', withdrawn.status === 200, String(withdrawn.status));
  check(
    'and the member is told what that does and does not mean',
    String(withdrawn.body.message).includes('already written'),
    String(withdrawn.body.message),
  );

  const blocked = await post('/api/journal/entries', { body: 'a new entry' }, token);
  check('new entries are refused afterwards', blocked.status === 451, String(blocked.status));

  // THE thing that must not go wrong. Withdrawing consent to process is not a request
  // to be erased, and treating it as one would destroy somebody's words at the exact
  // moment they asserted control over them.
  const stillThere = await get(`/api/journal/entries/${id}`, token);
  check('but the existing entry is STILL READABLE', stillThere.body.entry?.body === SECRET,
    String(stillThere.status));

  const twice = await post('/api/consent/withdraw/care-delivery', {}, token);
  check(
    'withdrawing twice is accepted identically',
    twice.status === 200 && JSON.stringify(twice.body) === JSON.stringify(withdrawn.body),
  );

  const records = await get('/api/consent/records', token);
  const care = (records.body.records ?? []).filter((r) => r.purpose === 'care-delivery');
  check(
    'the grant is kept beside the withdrawal, not overwritten',
    care.some((r) => r.state === 'withdrawn' && r.withdrawnAt && r.grantedAt),
    JSON.stringify(care[0] ?? {}),
  );

  const deleted = await del(`/api/journal/entries/${id}`, token);
  check('and the member can still delete it themselves', deleted.status === 204, String(deleted.status));

  redis.close();
  console.log(
    failures === 0
      ? c.green(`\nM7 holds — ${c.bold('every check passed')}\n`)
      : c.red(`\n${failures} check(s) FAILED\n`),
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  redis?.close();
  process.exit(1);
});
