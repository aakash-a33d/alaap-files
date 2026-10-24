#!/usr/bin/env node
/**
 * M5 — reports and appeals.
 *
 * The part of moderation a member touches. Two things are being checked:
 *
 *   A blocked reply leaves a VERDICT the member can appeal against. Without one, "you
 *   may appeal" is a sentence in a policy document rather than a thing that works.
 *
 *   Nothing here discloses what somebody else wrote. An appeal names a verdict, so an
 *   unknown verdict and somebody else's must be the same answer - otherwise the route
 *   confirms that a particular reply existed and was blocked.
 *
 *   node scripts/dev/moderation-flows.mjs
 */

import { Redis, DEFAULT_REDIS_URL, clearAbuseCounters } from './lib/redis.mjs';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8080';

async function call(method, path, body, token) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const post = (p, b, t) => call('POST', p, b, t);
const get = (p, t) => call('GET', p, undefined, t);

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
  const start = await post('/api/auth/register/start', { mobile });
  const verified = await post('/api/auth/register/verify', {
    challengeId: start.body.challengeId,
    code: start.body.devCode,
    ageConfirmed: true,
  });
  return verified.body.token;
}

async function main() {
  redis = new Redis(DEFAULT_REDIS_URL);
  await redis.connect();
  await clearAbuseCounters(redis);

  const author = await enrol();
  const replier = await enrol();
  const stranger = await enrol();

  const created = await post(
    '/api/community/posts',
    { categoryId: 'just-today', body: 'Another week where I could not get out of bed before noon.' },
    author,
  );
  const ref = created.body.post?.ref;
  check('set up a post to moderate', created.status === 201, String(created.status));

  // ------------------------------------------------------------------------
  console.log(c.bold('\nThe reasons a member is offered are metadata\n'));

  const reasons = await get('/api/moderation/reasons', replier);
  check('the reason lists load', reasons.status === 200, String(reasons.status));
  check('report reasons are offered', (reasons.body.report ?? []).length >= 5,
    String((reasons.body.report ?? []).length));
  check('including a catch-all, so nobody is forced into the wrong box',
    (reasons.body.report ?? []).some((r) => r.id === 'something_else'));
  check('appeal reasons are separate from report reasons',
    (reasons.body.appeal ?? []).some((r) => r.id === 'misunderstood'));
  check(
    'and none of them leaks a classifier category name',
    !JSON.stringify(reasons.body).match(/passive_aggressive|bullying_harassment|muril/i),
  );

  // ------------------------------------------------------------------------
  console.log(c.bold('\nA blocked reply leaves something to appeal against\n'));

  const blocked = await post(
    `/api/community/posts/${ref}/replies`,
    { body: 'you filthy idiot, nobody wants you here, get lost' },
    replier,
  );
  check('the cruel reply is blocked', blocked.status === 422, String(blocked.status));
  const verdictId = blocked.body.error?.verdictId;
  check('and carries a verdict id to appeal against',
    typeof verdictId === 'string' && verdictId.length > 20, String(verdictId));
  check(
    'the verdict id identifies a row, not a reason',
    !JSON.stringify(blocked.body).match(/bullying|hate_speech|threshold|score|muril/i),
    JSON.stringify(blocked.body),
  );

  const appeal = await post(
    '/api/moderation/appeals',
    { verdictId, reasonCode: 'misunderstood', statement: 'I was quoting what someone said to me.' },
    replier,
  );
  check('the author of the reply can appeal it', appeal.status === 201, JSON.stringify(appeal.body).slice(0, 110));
  check('and the appeal opens', appeal.body.appeal?.state === 'open', String(appeal.body.appeal?.state));

  const twice = await post(
    '/api/moderation/appeals',
    { verdictId, reasonCode: 'misunderstood' },
    replier,
  );
  check('a second appeal on the same verdict is refused', twice.status === 409, String(twice.status));

  const mine = await get('/api/moderation/appeals', replier);
  check('a member can see their own appeals', mine.status === 200 && (mine.body.appeals ?? []).length === 1,
    `${mine.status} ${(mine.body.appeals ?? []).length}`);

  // THE disclosure check. Somebody else's verdict must be indistinguishable from one
  // that does not exist, or the route confirms that a particular reply was blocked.
  const notYours = await post(
    '/api/moderation/appeals',
    { verdictId, reasonCode: 'misunderstood' },
    stranger,
  );
  const notReal = await post(
    '/api/moderation/appeals',
    { verdictId: '00000000-0000-4000-8000-000000000000', reasonCode: 'misunderstood' },
    stranger,
  );
  check("appealing somebody else's verdict is refused", notYours.status === 404, String(notYours.status));
  check('as is a verdict that never existed', notReal.status === 404, String(notReal.status));
  check(
    'and the two are INDISTINGUISHABLE',
    notYours.status === notReal.status &&
      JSON.stringify(notYours.body) === JSON.stringify(notReal.body),
    `${JSON.stringify(notYours.body)} vs ${JSON.stringify(notReal.body)}`,
  );

  const badReason = await post(
    '/api/moderation/appeals',
    { verdictId, reasonCode: 'because_i_said_so' },
    replier,
  );
  check('an unknown appeal reason is refused', badReason.status === 422, String(badReason.status));

  // ------------------------------------------------------------------------
  console.log(c.bold('\nReporting\n'));

  const report = await post(
    '/api/moderation/reports',
    { subjectType: 'post', subjectRef: ref, reasonCode: 'cruel_or_demeaning' },
    stranger,
  );
  check('a member can report a post', report.status === 202, String(report.status));
  check('and is thanked rather than given a case number',
    typeof report.body.message === 'string' && report.body.message.length > 10,
    String(report.body.message));

  const again = await post(
    '/api/moderation/reports',
    { subjectType: 'post', subjectRef: ref, reasonCode: 'cruel_or_demeaning' },
    stranger,
  );
  check('reporting twice is accepted the same way', again.status === 202, String(again.status));
  check(
    'with an IDENTICAL response — no "you already reported this"',
    JSON.stringify(again.body) === JSON.stringify(report.body),
    `${JSON.stringify(report.body)} vs ${JSON.stringify(again.body)}`,
  );

  const urgent = await post(
    '/api/moderation/reports',
    { subjectType: 'post', subjectRef: ref, reasonCode: 'encouraging_self_harm',
      note: 'They are telling people to give up.' },
    replier,
  );
  check('an urgent reason is accepted the same way as any other',
    urgent.status === 202, String(urgent.status));
  check('and the member is told nothing about its priority',
    JSON.stringify(urgent.body) === JSON.stringify(report.body));

  const badSubject = await post(
    '/api/moderation/reports',
    { subjectType: 'post', subjectRef: 'P-000001', reasonCode: 'cruel_or_demeaning' },
    stranger,
  );
  check('reporting something that does not exist is 404', badSubject.status === 404,
    String(badSubject.status));

  const badCode = await post(
    '/api/moderation/reports',
    { subjectType: 'post', subjectRef: ref, reasonCode: 'i_dislike_them' },
    stranger,
  );
  check('an unknown report reason is refused', badCode.status === 422, String(badCode.status));

  const anon = await post('/api/moderation/reports', {
    subjectType: 'post', subjectRef: ref, reasonCode: 'cruel_or_demeaning',
  });
  check('reporting needs a session', anon.status === 401, String(anon.status));

  // ------------------------------------------------------------------------
  console.log(c.bold('\nThe verdict table is not reachable from outside\n'));

  const forged = await post(
    '/api/moderation/internal/verdicts/comment',
    { commentRef: 'R-123456', decision: 'allowed', categories: [], modelId: 'x', modelVersion: 'x', latencyMs: 1 },
    replier,
  );
  check(
    'a member cannot record their own verdict',
    forged.status === 404 || forged.status === 405,
    String(forged.status),
  );

  redis.close();
  console.log(
    failures === 0
      ? c.green(`\nreports and appeals hold — ${c.bold('every check passed')}\n`)
      : c.red(`\n${failures} check(s) FAILED\n`),
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  redis?.close();
  process.exit(1);
});
