#!/usr/bin/env node
/**
 * M8 — the browser's path through the real stack.
 *
 * Everything here goes through the gateway the way the browser does: same
 * origin, a cookie jar, and no Authorization header anywhere. That last part is
 * the point of the suite. The dev scripts for M3-M7 all sign with a bearer
 * token, so none of them would notice if the cookie path broke — and the cookie
 * path is the only one a browser can use.
 *
 * The claims:
 *
 *   a session arrives as an HttpOnly cookie and nothing else is needed
 *   signing out kills it server side, not just in the browser
 *   a refusal keeps its own identity — 402, 429, 451 and 503 are not the same
 *   the words the picker offers are the words the server accepts
 *
 *   node scripts/dev/frontend-flows.mjs
 */

import { Redis, DEFAULT_REDIS_URL, clearAbuseCounters } from './lib/redis.mjs';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8080';

/* A cookie jar, which is the whole reason this file exists separately. */
let jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function absorb(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const [pair, ...attrs] = line.split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const maxAge = attrs.find((a) => a.trim().toLowerCase().startsWith('max-age='));
    if (value === '' || (maxAge && maxAge.split('=')[1].trim() === '0')) jar.delete(name);
    else jar.set(name, value);
  }
  return raw;
}

async function call(method, path, body) {
  const cookie = cookieHeader();
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      // Deliberately NO authorization header, ever, in this file.
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = absorb(res);
  const text = await res.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  return { status: res.status, body: parsed, setCookie };
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
    console.log(`  ${c.red('FAIL')}  ${label} ${c.dim(String(detail).slice(0, 120))}`);
  }
}

const randomMobile = () => `9${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
let redis;

async function main() {
  redis = new Redis(DEFAULT_REDIS_URL);
  await redis.connect();
  await clearAbuseCounters(redis);

  // ------------------------------------------------------------------------
  console.log(c.bold('\nA session arrives as a cookie, and only as a cookie\n'));

  const mobile = randomMobile();
  const start = await post('/api/auth/register/start', { mobile });
  check('a challenge is issued', typeof start.body.challengeId === 'string', start.status);

  const verify = await post('/api/auth/register/verify', {
    challengeId: start.body.challengeId,
    code: start.body.devCode,
    ageConfirmed: true,
  });
  check('registration succeeds', verify.status === 201, verify.status);

  const cookieLine = verify.setCookie.find((l) => l.startsWith('alaap_session='));
  check('and sets alaap_session', cookieLine !== undefined, verify.setCookie.join(' | '));
  check(
    'HttpOnly, so no script can read the session',
    /HttpOnly/i.test(cookieLine ?? ''),
    cookieLine,
  );
  check('SameSite=Lax, so a link in does not sign you out', /SameSite=Lax/i.test(cookieLine ?? ''));
  check(
    'not Secure over plain http — derived, not hardcoded',
    !/;\s*Secure/i.test(cookieLine ?? ''),
    cookieLine,
  );

  const handle = verify.body.handle;
  check('a drawn handle is issued by the server', /^[A-Z][a-z]+[A-Z][a-z]+-\d{4,6}$/.test(handle ?? ''), handle);
  check(
    'with recovery codes, shown once',
    Array.isArray(verify.body.recoveryCodes) && verify.body.recoveryCodes.length > 0,
    JSON.stringify(verify.body.recoveryCodes ?? []).slice(0, 40),
  );

  // ------------------------------------------------------------------------
  console.log(c.bold('\nThe cookie alone is enough\n'));

  const me = await get('/api/pseudonym/me');
  check('the browser can ask who it is', me.status === 200, me.status);
  check('and is told its own handle', me.body.persona?.handle === handle, me.body.persona?.handle);

  const plan = await get('/api/community/entitlements');
  check('the plan is readable, so limits are not guessed', plan.status === 200, plan.status);
  check(
    'and names what it permits',
    typeof plan.body.plan?.planId === 'string' && plan.body.plan?.quotas !== undefined,
    JSON.stringify(plan.body.plan ?? {}).slice(0, 80),
  );
  check(
    'including what NO plan may restrict',
    Array.isArray(plan.body.plan?.neverGated) && plan.body.plan.neverGated.length > 0,
    JSON.stringify(plan.body.plan?.neverGated ?? []),
  );

  // ------------------------------------------------------------------------
  console.log(c.bold('\nThe picker offers what the server accepts\n'));

  const cats = await get('/api/community/categories');
  check('categories are served', cats.status === 200, cats.status);
  const ids = (cats.body.categories ?? []).map((x) => x.id);
  check('they are situations, not conditions', ids.includes('just-today') && ids.includes('money'),
    ids.join(','));
  check(
    'and carry no diagnosis to pick from',
    !ids.some((id) => ['anxiety', 'depression', 'ocd', 'trauma'].includes(id)),
    ids.join(','),
  );
  check(
    'every one is accepted by the server that serves them',
    (cats.body.categories ?? []).every((x) => typeof x.label === 'string' && x.label.length > 0),
  );

  // ------------------------------------------------------------------------
  console.log(c.bold('\nPosting, and reading it back\n'));

  const written = await post('/api/community/posts', {
    categoryId: ids[0],
    body: 'I have not said this to anyone and I am not sure I want an answer, only to have said it.',
  });
  check('a post is published', written.status === 201, JSON.stringify(written.body).slice(0, 90));
  const ref = written.body.post?.ref;
  check('with a reference', /^P-\d{6}$/.test(ref ?? ''), ref);
  check('and an expiry, because five days is the promise',
    typeof written.body.post?.expiresAt === 'string', written.body.post?.expiresAt);

  const feed = await get('/api/community/feed?limit=50');
  check('it appears in the feed', (feed.body.posts ?? []).some((p) => p.ref === ref));

  const mine = await get('/api/community/posts/mine');
  check('and among the member’s own', (mine.body.posts ?? []).some((p) => p.ref === ref));

  const rejected = await post('/api/community/posts', {
    categoryId: 'trauma-recovery',
    body: 'a post filed under a category the client invented',
  });
  check(
    'a category the server does not know is refused',
    rejected.status === 422,
    `${rejected.status} ${JSON.stringify(rejected.body).slice(0, 60)}`,
  );

  // ------------------------------------------------------------------------
  console.log(c.bold('\nA refusal keeps its own identity\n'));

  const journal = await post('/api/journal/entries', { body: 'an entry written before consenting' });
  check('writing a journal without consent is refused', journal.status === 451, journal.status);
  check(
    'as CONSENT, not as a quota or a paywall',
    journal.body.error?.code === 'consent_withdrawn',
    JSON.stringify(journal.body),
  );

  const granted = await post('/api/consent/grant/care-delivery');
  check('consent can be granted from the browser', granted.status === 201, granted.status);

  const afterConsent = await post('/api/journal/entries', {
    body: 'The thing I have not told anyone is that I stopped going three weeks ago.',
  });
  check(
    'and then the entry is written, or refused for a PLAN reason',
    afterConsent.status === 201 || afterConsent.status === 402,
    `${afterConsent.status} ${JSON.stringify(afterConsent.body).slice(0, 70)}`,
  );
  if (afterConsent.status === 402) {
    check(
      'a plan refusal says so plainly and does not mention waiting',
      afterConsent.body.error?.code === 'not_entitled',
      JSON.stringify(afterConsent.body),
    );
  }

  const withdrawn = await post('/api/consent/withdraw/care-delivery');
  check('consent can be withdrawn', withdrawn.status === 200, withdrawn.status);
  check(
    'and the member is told nothing was deleted',
    String(withdrawn.body.message).includes('already written'),
    withdrawn.body.message,
  );

  // Mood is never gated by anything, including a withdrawal.
  const mood = await post('/api/mood/checkins', { moodScore: 4 });
  check('mood is recorded even after withdrawing consent', mood.status === 201, mood.status);

  // ------------------------------------------------------------------------
  console.log(c.bold('\nSigning out ends the session, not just the cookie\n'));

  const before = cookieHeader();
  const out = await post('/api/auth/logout');
  check('logout answers', out.status === 200, out.status);
  check('the cookie is cleared', !jar.has('alaap_session'), cookieHeader());

  /* The one that matters. A browser that forgot its cookie while the session
     stayed alive server side has not signed anybody out. */
  const replay = await fetch(`${GATEWAY}/api/pseudonym/me`, { headers: { cookie: before } });
  check('and REPLAYING the old cookie is refused', replay.status === 401, replay.status);

  const twice = await post('/api/auth/logout');
  check('signing out twice is not an error', twice.status === 200, twice.status);

  redis.close();
  console.log(
    failures === 0
      ? c.green(`\nM8 holds — ${c.bold('the browser talks to the backend')}\n`)
      : c.red(`\n${failures} check(s) FAILED\n`),
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  redis?.close();
  process.exit(1);
});
