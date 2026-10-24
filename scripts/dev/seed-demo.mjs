#!/usr/bin/env node
/**
 * Seed a demo account and a feed worth testing against.
 *
 *   node scripts/dev/seed-demo.mjs
 *
 * Creates one account you can sign in as, plus a few other members with posts, so the
 * feed has somebody else's words in it. That matters for testing the safety filter: a
 * member's own post is never moderated — every category needs a recipient — so the
 * only way to see A1 work is to reply to someone else.
 *
 * Everything goes through the gateway, exactly as the browser does, so the audit trail,
 * consent checks and quota all apply and the resulting state is state the product could
 * really have reached.
 *
 * One exception, and it is marked where it happens: the week of back-dated mood
 * check-ins is written straight to clinical_vault, because the check-in endpoint takes
 * no date and must not. See `seedMoodHistory`.
 *
 * Safe to re-run: the demo number signs in rather than registering if it already
 * exists, and the other members get fresh numbers each time.
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Redis, DEFAULT_REDIS_URL, clearAbuseCounters } from './lib/redis.mjs';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8080';
const COMPOSE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../infrastructure/docker/compose');

/** The one you sign in with. Fixed so it is the same number every time. */
const DEMO_MOBILE = '9000000001';

const c = {
  green: (s) => `\u001b[32m${s}\u001b[0m`,
  red: (s) => `\u001b[31m${s}\u001b[0m`,
  dim: (s) => `\u001b[2m${s}\u001b[0m`,
  bold: (s) => `\u001b[1m${s}\u001b[0m`,
};

/** A cookie jar per member, so each acts as its own browser would. */
function member() {
  return { jar: new Map() };
}

function cookieHeader(m) {
  return [...m.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function call(m, method, path, body) {
  const cookie = cookieHeader(m);
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    m.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  const text = await res.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  return { status: res.status, body: parsed };
}

const randomMobile = () => `9${String(Math.floor(Math.random() * 900000000) + 100000000)}`;

/** Register, or sign in if the number is already taken. */
async function enrol(m, mobile) {
  const start = await call(m, 'POST', '/api/auth/register/start', { mobile });
  if (start.status === 202 || start.status === 200) {
    const verified = await call(m, 'POST', '/api/auth/register/verify', {
      challengeId: start.body.challengeId,
      code: start.body.devCode,
      ageConfirmed: true,
    });
    if (verified.status === 201) {
      return {
        handle: verified.body.handle,
        pseudoId: verified.body.pseudoId,
        recoveryCodes: verified.body.recoveryCodes ?? [],
        fresh: true,
      };
    }
  }
  // Already registered — sign in instead.
  const otp = await call(m, 'POST', '/api/auth/login/otp/start', { mobile });
  const signedIn = await call(m, 'POST', '/api/auth/login/otp/verify', {
    challengeId: otp.body.challengeId,
    code: otp.body.devCode,
  });
  if (signedIn.status !== 200) {
    throw new Error(`could not enrol ${mobile}: ${signedIn.status} ${JSON.stringify(signedIn.body)}`);
  }
  return {
    handle: signedIn.body.handle,
    pseudoId: signedIn.body.pseudoId,
    recoveryCodes: [],
    fresh: false,
  };
}

/**
 * Seven days of check-ins, ending yesterday.
 *
 * Written straight to clinical_vault, which is the one thing in this script that does
 * not go through the gateway. It cannot: `POST /api/mood/checkins` always writes to
 * CURRENT_DATE and takes no date, deliberately — a client that can name the day can
 * forge a history, and a mood chart is only worth looking at if nobody can.
 *
 * So the rule the rest of the file follows is broken here on purpose, and only here.
 *
 * Today is left empty. That is the point of the exercise: sign in, find a week of
 * history already drawn, press Save today, and watch today's reading join the end of
 * the line. It also exercises the real write path for the one day it can.
 *
 * These numbers are invented, and that is defensible here in a way it was not on the
 * dashboard: this is a demo account that exists to be tested, not a member being shown
 * a fabricated record of their own moods. The dashboard's seeded sine wave was deleted
 * for exactly that reason — see docs/Alaap-Status-and-Roadmap.docx, section 4.7.
 *
 * The arc is a rough week easing off: bad sleep and high stress early, both improving.
 * Loosely correlated rather than locked together, because a chart where three lines
 * move as one looks generated, and because people do not work that way.
 */
const MOOD_WEEK = [
  { back: 7, mood: 4, sleep: 5.5, stress: 7 },
  { back: 6, mood: 3, sleep: 4.5, stress: 8 },
  { back: 5, mood: 5, sleep: 6.5, stress: 6 },
  { back: 4, mood: 6, sleep: 7.0, stress: 5 },
  { back: 3, mood: 5, sleep: 6.0, stress: 6 },
  { back: 2, mood: 7, sleep: 7.5, stress: 4 },
  { back: 1, mood: 6, sleep: 7.0, stress: 4 },
];

function seedMoodHistory(pseudoId) {
  if (typeof pseudoId !== 'number' && typeof pseudoId !== 'string') return 0;

  // ON CONFLICT so re-running the script moves the week along rather than failing on
  // the (pseudo_id, entry_date) unique constraint.
  const values = MOOD_WEEK.map(
    (d) =>
      `(${pseudoId}, CURRENT_DATE - ${d.back}, ${d.mood}, ${d.sleep}, ${d.stress}, '{}')`,
  ).join(', ');

  execFileSync(
    'docker',
    [
      'compose', 'exec', '-T', 'postgres-shared',
      'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'clinical_vault', '-tAc',
      `INSERT INTO mood_checkins
         (pseudo_id, entry_date, mood_score, sleep_hours, stress_score, emotion_tags)
       VALUES ${values}
       ON CONFLICT (pseudo_id, entry_date) DO UPDATE
         SET mood_score   = EXCLUDED.mood_score,
             sleep_hours  = EXCLUDED.sleep_hours,
             stress_score = EXCLUDED.stress_score`,
    ],
    { cwd: COMPOSE_DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
  return MOOD_WEEK.length;
}

/* Written to read like real posts rather than samples: unfinished, specific, and not
   dramatic. Nothing here is drawn from anybody's real words. */
const OTHERS = [
  {
    categoryId: 'work-and-career',
    body:
      'I handed in my notice on Tuesday and I have not told my parents yet. Every time I pick up ' +
      'the phone I put it down again. I keep rehearsing it and the rehearsal never sounds right.',
    reply:
      'The rehearsing is the worst part, I think. Mine went nothing like the version I practised ' +
      'and it was still fine.',
  },
  {
    categoryId: 'sleep-and-rest',
    body:
      'Fourth night this week I have been awake past three. Not thinking about anything in ' +
      'particular. Just awake, and then the alarm goes and I pretend I slept.',
  },
  {
    categoryId: 'family',
    body:
      'My brother got engaged and I am happy for him and I also cried in the bathroom at the ' +
      'function. Both of those are true and I do not know what to do with that.',
  },
];

const DEMO_POST = {
  categoryId: 'just-today',
  body:
    'Nothing happened today. I got through it. I am writing that down because I keep being told ' +
    'that counts and I would like to find out if it does.',
};

let redis;

async function main() {
  redis = new Redis(DEFAULT_REDIS_URL);
  await redis.connect();
  // Otherwise several enrolments in a row trip the per-number send gate.
  await clearAbuseCounters(redis);

  console.log(c.bold('\nOther members, so the feed is not just you\n'));

  const refs = [];
  for (const spec of OTHERS) {
    await clearAbuseCounters(redis);
    const who = member();
    const { handle } = await enrol(who, randomMobile());
    const post = await call(who, 'POST', '/api/community/posts', {
      categoryId: spec.categoryId,
      body: spec.body,
    });
    if (post.status !== 201) {
      console.log(`  ${c.red('FAIL')} ${handle}: ${post.status} ${JSON.stringify(post.body).slice(0, 80)}`);
      continue;
    }
    refs.push(post.body.post.ref);
    console.log(`  ${c.green('post')} ${post.body.post.ref} ${c.dim(`${handle} · ${spec.categoryId}`)}`);

    // One thread gets a peer reply, so the feed shows a conversation and not only
    // openings. It goes through A1 like any other reply.
    if (spec.reply !== undefined) {
      await clearAbuseCounters(redis);
      const peer = member();
      await enrol(peer, randomMobile());
      const reply = await call(peer, 'POST', `/api/community/posts/${post.body.post.ref}/replies`, {
        body: spec.reply,
      });
      console.log(
        reply.status === 201
          ? `  ${c.green('reply')} ${c.dim('on ' + post.body.post.ref + ' — passed the safety check')}`
          : `  ${c.red('reply')} ${reply.status} ${JSON.stringify(reply.body).slice(0, 70)}`,
      );
    }
  }

  console.log(c.bold('\nYour demo account\n'));

  await clearAbuseCounters(redis);
  const you = member();
  const demo = await enrol(you, DEMO_MOBILE);
  console.log(`  ${c.green('handle')} ${c.bold(demo.handle)}`);
  if (demo.fresh && demo.recoveryCodes.length > 0) {
    console.log(`  ${c.dim('recovery codes (shown once, keep these):')}`);
    console.log(`  ${c.dim('  ' + demo.recoveryCodes.join('  '))}`);
  }

  // A post of your own, so there is an AI first response to look at. B1 writes it a
  // few seconds later — the worker polls every five seconds.
  const own = await call(you, 'POST', '/api/community/posts', DEMO_POST);
  if (own.status === 201) {
    console.log(`  ${c.green('post')} ${own.body.post.ref} ${c.dim('— Alaap AI will answer this within ~10s')}`);
  } else {
    console.log(`  ${c.dim('post skipped: ' + own.status + ' (quota, probably — re-run resets nothing)')}`);
  }

  // A week of check-ins ending yesterday, so the chart has a shape before you touch it
  // and today is still yours to add.
  const seededDays = seedMoodHistory(demo.pseudoId);
  console.log(
    seededDays > 0
      ? `  ${c.green('mood')} ${seededDays} days of check-ins ${c.dim('— today left empty, so Save today adds to them')}`
      : `  ${c.dim('mood history skipped: no pseudo id returned')}`,
  );

  // Consent for the journal, so the clinical surface is testable without a 451 first.
  const consent = await call(you, 'POST', '/api/consent/grant/care-delivery');
  console.log(
    consent.status === 201 || consent.status === 200
      ? `  ${c.green('consent')} ${c.dim('care-delivery granted — the journal will accept writes')}`
      : `  ${c.dim('consent already granted')}`,
  );

  redis.close();

  console.log(c.bold('\n──────────────────────────────────────────────────────────────'));
  console.log(c.bold('  How to sign in\n'));
  console.log(`  1. Open ${c.bold('http://localhost:5177/signin')}`);
  console.log(`  2. Country ${c.bold('India (+91)')}, number ${c.bold(DEMO_MOBILE)}`);
  console.log(`  3. The six-digit code appears on the page under ${c.bold('Development')}`);
  console.log(c.dim('     (there is no SMS gateway locally, so the code is shown instead)'));
  console.log(c.bold('\n  What to try\n'));
  console.log('  · Dashboard — a week of check-ins is already drawn, ending yesterday.');
  console.log('    Set mood, sleep and stress, press Save today, and today joins the line.');
  console.log(c.dim('    Press Save twice and it replaces rather than appends: a check-in is a'));
  console.log(c.dim('    statement about a day, not an event log.'));
  console.log('  · Community — your post has an Alaap AI first response.');
  console.log(`  · Reply to somebody else's post with something ordinary. It sends.`);
  console.log('  · Reply with something cruel. The button changes to "Rewrite to send"');
  console.log('    and will not let you. That is A1, server side.');
  console.log('  · Privacy controls — verify with a code, then export or delete.');
  console.log(c.dim('\n  A post of your own is never moderated. Only replies are, because'));
  console.log(c.dim('  every category needs somebody on the receiving end.\n'));
}

main().catch((err) => {
  console.error(c.red(`\n${err.message}\n`));
  redis?.close();
  process.exit(1);
});
