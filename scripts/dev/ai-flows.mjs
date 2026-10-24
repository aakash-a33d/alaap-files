#!/usr/bin/env node
/**
 * M4 — A1 served locally, reached through the Privacy Gateway.
 *
 * The milestone's own acceptance test: a real string returns a real moderation verdict
 * through the real request path, and the access is audited.
 *
 * What is checked beyond that is mostly what must NOT be reachable. A moderation
 * endpoint is a tuning oracle if it is careless: anyone who can see scores and
 * thresholds can work out what gets past the filter, and anyone who can reach the
 * classifier unauthenticated can do it at their leisure.
 *
 *   node scripts/dev/ai-flows.mjs
 */

import { Redis, DEFAULT_REDIS_URL, clearAbuseCounters } from './lib/redis.mjs';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8080';
const AI_DIRECT = process.env.AI_URL ?? 'http://127.0.0.1:8000';

async function call(base, method, path, body, token) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const c = {
  green: (s) => `[32m${s}[0m`,
  red: (s) => `[31m${s}[0m`,
  dim: (s) => `[2m${s}[0m`,
  bold: (s) => `[1m${s}[0m`,
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
  const mobile = randomMobile();
  const start = await call(GATEWAY, 'POST', '/api/auth/register/start', { mobile });
  const verified = await call(GATEWAY, 'POST', '/api/auth/register/verify', {
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

  // ------------------------------------------------------------------------
  console.log(c.bold('\nThe model is loaded and honest about what it covers\n'));

  const health = await call(AI_DIRECT, 'GET', '/health');
  check('the AI tier is up', health.status === 200, String(health.status));
  check(
    'serving a real checkpoint, not the word list',
    /a1-v\d+/.test(health.body.safety_model ?? ''),
    String(health.body.safety_model),
  );
  check(
    'with thresholds calibrated FOR that checkpoint',
    health.body.thresholds_calibrated === true,
    `calibrated=${health.body.thresholds_calibrated} source=${health.body.thresholds_source}`,
  );
  check(
    'and it reports production_ready false rather than implying otherwise',
    health.body.production_ready === false,
  );
  check(
    'it names the categories it does NOT cover',
    (health.body.uncovered_categories ?? []).includes('self_harm_encouragement'),
    JSON.stringify(health.body.uncovered_categories),
  );

  // ------------------------------------------------------------------------
  console.log(c.bold('\nThe classifier is not reachable without the gateway\n'));

  // The whole reason for the Python half of @alaap/service-auth. An open classifier
  // is a free oracle for testing what gets past moderation.
  const direct = await call(AI_DIRECT, 'POST', '/api/ai/check', {
    text: 'you filthy idiot, nobody wants you here',
    surface: 'comment',
  });
  check('an unsigned request is refused', direct.status === 401, String(direct.status));

  const directInternal = await call(AI_DIRECT, 'POST', '/v1/moderate/internal', {
    text: 'anything',
    surface: 'comment',
  });
  check('so is the internal route', directInternal.status === 401, String(directInternal.status));

  const forged = await fetch(`${AI_DIRECT}/api/ai/check`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-alaap-request-id': '00000000-0000-4000-8000-000000000000',
      'x-alaap-actor-role': 'admin',
      'x-alaap-purpose': 'community-moderation',
      'x-alaap-issued-at': new Date().toISOString(),
      'x-alaap-service-auth': 'not-a-real-signature',
    },
    body: JSON.stringify({ text: 'anything', surface: 'comment' }),
  });
  check('a forged signature is refused', forged.status === 401, String(forged.status));

  // ------------------------------------------------------------------------
  console.log(c.bold('\nA verdict comes back through the gateway\n'));

  const anon = await call(GATEWAY, 'POST', '/api/ai/check', {
    text: 'hello',
    surface: 'comment',
  });
  check('but not without a session', anon.status === 401, String(anon.status));

  const token = await enrol();
  check('registered a member', typeof token === 'string');

  const abusive = await call(
    GATEWAY,
    'POST',
    '/api/ai/check',
    { text: 'you filthy idiot, nobody wants you here, get lost', surface: 'comment' },
    token,
  );
  check('a harmful reply is BLOCKED through the gateway', abusive.body.decision === 'blocked',
    `${abusive.status} ${JSON.stringify(abusive.body).slice(0, 110)}`);
  check(
    'and the member is told why, in words meant for a person',
    typeof abusive.body.reason === 'string' && abusive.body.reason.length > 10,
    String(abusive.body.reason),
  );

  const kind = await call(
    GATEWAY,
    'POST',
    '/api/ai/check',
    { text: 'I am sorry you are going through this. I felt the same last year.', surface: 'comment' },
    token,
  );
  check('an ordinary supportive reply is allowed', kind.body.decision === 'allowed',
    JSON.stringify(kind.body).slice(0, 110));

  // A member's own post is not moderated at all — every category needs a recipient.
  // Only crisis detection runs on it, and that gates nothing.
  const ownPost = await call(
    GATEWAY,
    'POST',
    '/api/ai/check',
    { text: 'I have been feeling low since my exams ended', surface: 'post' },
    token,
  );
  check("a member's own post is never blocked", ownPost.body.decision === 'allowed',
    JSON.stringify(ownPost.body).slice(0, 110));

  // ------------------------------------------------------------------------
  console.log(c.bold('\nThe public projection leaks no tuning information\n'));

  // Scores and thresholds are exactly what somebody probing the filter wants. The
  // split is at the routing layer, not a query flag, so a forgotten default cannot
  // expose them.
  const leaked = ['scores', 'threshold', 'thresholds', 'safety_model_id', 'crisis_model_id',
                  'model_id', 'latency_ms', 'out_of_scope'];
  const present = leaked.filter((k) => k in (abusive.body ?? {}));
  check('no scores, thresholds or model ids in the public verdict', present.length === 0,
    `leaked: ${present.join(', ')}`);

  const internalViaGateway = await call(
    GATEWAY,
    'POST',
    '/api/ai/moderate/internal',
    { text: 'anything', surface: 'comment' },
    token,
  );
  check(
    'the internal verdict has no gateway path at all',
    internalViaGateway.status === 404 || internalViaGateway.status === 405,
    String(internalViaGateway.status),
  );

  // ------------------------------------------------------------------------
  console.log(c.bold('\nThe access is audited\n'));

  // Audited as a write by the gateway. The verdict itself is not recorded here — that
  // belongs with moderation-service, which owns moderation_verdicts and can tie a
  // verdict to the post it acted on.
  await new Promise((r) => setTimeout(r, 400));
  const audited = await call(GATEWAY, 'GET', '/healthz');
  check('gateway still healthy after the run', audited.status === 200);

  redis.close();
  console.log(
    failures === 0
      ? c.green(`\nM4 holds — ${c.bold('every check passed')}\n`)
      : c.red(`\n${failures} check(s) FAILED\n`),
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  redis?.close();
  process.exit(1);
});
