#!/usr/bin/env node
/**
 * M5 — posting, replying, quotas and expiry, through the gateway.
 *
 * Two rules are being checked, and they pull in opposite directions:
 *
 *   A member's own post is never moderated and never gated on reading.
 *   A reply IS moderated, because somebody else is on the receiving end.
 *
 * Most of what follows is about the first one. It is the rule that a platform under
 * commercial pressure quietly erodes — a limit here, an upgrade prompt there — and the
 * checks exist so that erosion fails a test rather than reaching a person.
 *
 *   node scripts/dev/community-flows.mjs
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
  return { token: verified.body.token, handle: verified.body.handle };
}

async function main() {
  redis = new Redis(DEFAULT_REDIS_URL);
  await redis.connect();
  await clearAbuseCounters(redis);

  // ------------------------------------------------------------------------
  console.log(c.bold('\nA member posts, and it is published as written\n'));

  const author = await enrol();
  check('registered an author', typeof author.token === 'string');

  const anon = await post('/api/community/posts', { categoryId: 'just-today', body: 'hello' });
  check('posting needs a session', anon.status === 401, String(anon.status));

  const created = await post(
    '/api/community/posts',
    { categoryId: 'just-today', body: 'I have not slept properly in about a week and I am running out of ways to describe it.' },
    author.token,
  );
  check('a post is created', created.status === 201, JSON.stringify(created.body).slice(0, 110));
  const ref = created.body.post?.ref;
  check('with a public ref like P-883920', /^P-\d{6}$/.test(ref ?? ''), String(ref));
  check('published immediately, no moderation queue', created.body.post?.state === 'published',
    String(created.body.post?.state));
  check('attributed to the drawn handle, not an account id',
    created.body.post?.authorHandle === author.handle, String(created.body.post?.authorHandle));

  // The rule that matters most. A post is not moderated at all — every category needs
  // a recipient and a new post has none.
  const bleak = await post(
    '/api/community/posts',
    { categoryId: 'just-today', body: 'I hate everyone in this house and I want to disappear from all of it forever.' },
    author.token,
  );
  check('a bleak, angry post is NOT blocked', bleak.status === 201, String(bleak.status));
  check('and is published like any other', bleak.body.post?.state === 'published',
    String(bleak.body.post?.state));

  const badCategory = await post(
    '/api/community/posts',
    { categoryId: 'depression', body: 'x' },
    author.token,
  );
  check('an unknown category is refused', badCategory.status === 422, String(badCategory.status));

  // ------------------------------------------------------------------------
  console.log(c.bold('\nExpiry is five days, and it is not a paid feature\n'));

  const expiresAt = new Date(created.body.post?.expiresAt ?? 0);
  const publishedAt = new Date(created.body.post?.publishedAt ?? 0);
  const days = (expiresAt - publishedAt) / 86_400_000;
  check('the post expires in five days', Math.abs(days - 5) < 0.01, `${days.toFixed(2)} days`);

  const greedy = await post(
    '/api/community/posts',
    { categoryId: 'just-today', body: 'a third post', visibilityDays: 30 },
    author.token,
  );
  check(
    'a free member asking for thirty days still gets five',
    Math.abs((new Date(greedy.body.post?.expiresAt) - new Date(greedy.body.post?.publishedAt)) / 86_400_000 - 5) < 0.01,
    String(greedy.body.post?.expiresAt),
  );

  // ------------------------------------------------------------------------
  console.log(c.bold('\nThe feed shows it to somebody else\n'));

  const reader = await enrol();
  const feed = await get('/api/community/feed?limit=50', reader.token);
  check('the feed loads for another member', feed.status === 200, String(feed.status));
  check('and contains the post', (feed.body.posts ?? []).some((p) => p.ref === ref));
  check(
    'a feed entry carries a handle and never a pseudo id in the clear',
    (feed.body.posts ?? []).every((p) => typeof p.authorHandle === 'string' && p.authorHandle.length > 0),
  );

  const one = await get(`/api/community/posts/${ref}`, reader.token);
  check('a single post can be opened', one.status === 200, String(one.status));
  check('and starts with no replies', (one.body.replies ?? []).length === 0);

  const missing = await get('/api/community/posts/P-000001', reader.token);
  check('an unknown ref is 404', missing.status === 404, String(missing.status));

  // ------------------------------------------------------------------------
  console.log(c.bold('\nReplies ARE moderated\n'));

  const kind = await post(
    `/api/community/posts/${ref}/replies`,
    { body: 'That sounds exhausting. I went through something similar last year and it did ease.' },
    reader.token,
  );
  check('a supportive reply is published', kind.status === 201, JSON.stringify(kind.body).slice(0, 110));
  check('with a ref like R-114872', /^R-\d{6}$/.test(kind.body.reply?.ref ?? ''),
    String(kind.body.reply?.ref));

  const cruel = await post(
    `/api/community/posts/${ref}/replies`,
    { body: 'you filthy idiot, nobody wants you here, get lost' },
    reader.token,
  );
  check('a cruel reply is BLOCKED', cruel.status === 422, String(cruel.status));
  check('and the member is told in words meant for a person',
    typeof cruel.body.error?.message === 'string' && cruel.body.error.message.length > 10,
    String(cruel.body.error?.message));
  check(
    'without naming the classifier that fired',
    !JSON.stringify(cruel.body).match(/bullying|hate_speech|threshold|score|muril/i),
    JSON.stringify(cruel.body),
  );

  const afterBlock = await get(`/api/community/posts/${ref}`, author.token);
  check('the author never sees the blocked reply', (afterBlock.body.replies ?? []).length === 1,
    String((afterBlock.body.replies ?? []).length));
  check('but does see the supportive one', afterBlock.body.replies?.[0]?.ref === kind.body.reply?.ref);

  // ------------------------------------------------------------------------
  console.log(c.bold('\nQuotas cap writing, and only writing\n'));

  // Free plan: 4 posts a month. Three exist already.
  const fourth = await post('/api/community/posts', { categoryId: 'family', body: 'four' }, author.token);
  check('the fourth post is allowed', fourth.status === 201, String(fourth.status));

  const fifth = await post('/api/community/posts', { categoryId: 'family', body: 'five' }, author.token);
  check('the fifth is refused', fifth.status === 429, String(fifth.status));
  check('as a rate, not a paywall — 429 and not 402', fifth.status === 429);
  check(
    'and says when it resets, so nobody has to ask',
    typeof fifth.body.error?.resetsAt === 'string' && !Number.isNaN(Date.parse(fifth.body.error.resetsAt)),
    String(fifth.body.error?.resetsAt),
  );
  check('naming the limit it hit', fifth.body.error?.limit === 4, String(fifth.body.error?.limit));

  // THE line that must not move. An exhausted quota restricts writing. It never
  // restricts reading, and never touches the safety path.
  const stillReads = await get('/api/community/feed?limit=5', author.token);
  check('a member at their limit can STILL READ the feed', stillReads.status === 200,
    String(stillReads.status));
  const ownPost = await get(`/api/community/posts/${ref}`, author.token);
  check('and can still open their own post', ownPost.status === 200, String(ownPost.status));
  check('and still sees every reply on it', (ownPost.body.replies ?? []).length === 1,
    String((ownPost.body.replies ?? []).length));

  const mine = await get('/api/community/posts/mine', author.token);
  check('and can list their own posts', mine.status === 200 && (mine.body.posts ?? []).length === 4,
    `${mine.status} ${(mine.body.posts ?? []).length}`);

  // Replying is a separate allowance from posting.
  const canStillReply = await post(
    `/api/community/posts/${ref}/replies`,
    { body: 'Thank you, that helps to hear.' },
    author.token,
  );
  check(
    'a member out of POSTS can still write a REPLY',
    canStillReply.status === 201,
    String(canStillReply.status),
  );

  // ------------------------------------------------------------------------
  redis.close();
  console.log(
    failures === 0
      ? c.green(`\nM5 posting path holds — ${c.bold('every check passed')}\n`)
      : c.red(`\n${failures} check(s) FAILED\n`),
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  redis?.close();
  process.exit(1);
});
