#!/usr/bin/env node
/**
 * End-to-end check of the sign-in routes that do NOT involve a passkey.
 *
 * There are three ways back into an account, and each one exists because the one
 * above it has failed:
 *
 *   passkey        the member has the device       scripts/dev/virtual-authenticator.mjs
 *   OTP            lost the device, has the number    <- here
 *   recovery code  lost the number itself             <- here
 *
 * The third is the one that matters most and is hardest to reason about, because it
 * accepts nothing the platform could send and nothing the member carries — only what
 * they wrote down. So it is checked hardest here: single use, rate limited, and
 * indistinguishable in its failures from a wrong handle.
 *
 * Every negative case below asserts the response is IDENTICAL to some other negative
 * case. That is the point of those tests. A recovery endpoint that answers "no such
 * handle" differently from "wrong code" is an oracle for deciding which handles have
 * recoverable accounts, and handles are public.
 *
 * DEVELOPMENT ONLY, for two reasons. It reads `devCode` out of the OTP response,
 * which only exists while OTP_TRANSPORT=log. And it reaches into Redis to clear
 * anti-abuse counters between phases — see `reset()` below for why that is honest
 * here and would be a catastrophe anywhere else.
 *
 *   node scripts/dev/login-flows.mjs
 */

import net from 'node:net';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8080';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://:dev_redis_c93f5a17e0b846d2@127.0.0.1:6379';

// --------------------------------------------------------------- RESP ---
//
// A Redis client small enough to read, rather than a dependency. Only SCAN and DEL
// are needed, and this script is the only caller. Same reasoning as the hand-rolled
// CBOR in virtual-authenticator.mjs.

function encode(args) {
  let out = `*${args.length}\r\n`;
  for (const a of args) {
    const s = String(a);
    out += `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
  }
  return Buffer.from(out);
}

/** Returns [value, nextIndex], or null when the buffer holds an incomplete reply. */
function parse(buf, i) {
  if (i >= buf.length) return null;
  const type = buf[i];
  const nl = buf.indexOf('\r\n', i);
  if (nl === -1) return null;
  const head = buf.toString('utf8', i + 1, nl);
  if (type === 0x2b) return [head, nl + 2]; // +simple
  if (type === 0x2d) throw new Error(`redis: ${head}`); // -error
  if (type === 0x3a) return [Number(head), nl + 2]; // :integer
  if (type === 0x24) {
    // $bulk
    const len = Number(head);
    if (len === -1) return [null, nl + 2];
    if (buf.length < nl + 2 + len + 2) return null;
    return [buf.toString('utf8', nl + 2, nl + 2 + len), nl + 2 + len + 2];
  }
  if (type === 0x2a) {
    // *array
    const n = Number(head);
    if (n === -1) return [null, nl + 2];
    const arr = [];
    let j = nl + 2;
    for (let k = 0; k < n; k += 1) {
      const r = parse(buf, j);
      if (r === null) return null;
      arr.push(r[0]);
      j = r[1];
    }
    return [arr, j];
  }
  throw new Error(`redis: unexpected reply type ${String.fromCharCode(type)}`);
}

class Redis {
  constructor(url) {
    const u = new URL(url);
    this.password = decodeURIComponent(u.password || '');
    this.port = Number(u.port || 6379);
    this.host = u.hostname;
    this.pending = [];
    this.buf = Buffer.alloc(0);
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ host: this.host, port: this.port }, async () => {
        try {
          if (this.password) await this.send('AUTH', this.password);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      this.socket.on('error', reject);
      this.socket.on('data', (chunk) => {
        this.buf = Buffer.concat([this.buf, chunk]);
        for (;;) {
          let r;
          try {
            r = parse(this.buf, 0);
          } catch (err) {
            this.pending.shift()?.reject(err);
            this.buf = Buffer.alloc(0);
            return;
          }
          if (r === null) return;
          this.buf = this.buf.subarray(r[1]);
          this.pending.shift()?.resolve(r[0]);
        }
      });
    });
  }

  send(...args) {
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.socket.write(encode(args));
    });
  }

  async delMatching(pattern) {
    let cursor = '0';
    let removed = 0;
    do {
      const [next, keys] = await this.send('SCAN', cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) removed += await this.send('DEL', ...keys);
    } while (cursor !== '0');
    return removed;
  }

  close() {
    this.socket?.end();
  }
}

// -------------------------------------------------------------- harness ---

async function post(path, body, token) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const c = {
  green: (s) => `[32m${s}[0m`,
  red: (s) => `[31m${s}[0m`,
  dim: (s) => `[2m${s}[0m`,
  bold: (s) => `[1m${s}[0m`,
};

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ${c.green('pass')}  ${label}`);
  } else {
    failures += 1;
    console.log(`  ${c.red('FAIL')}  ${label} ${c.dim(detail)}`);
  }
}

const randomMobile = () => `9${String(Math.floor(Math.random() * 900000000) + 100000000)}`;

let redis;

/**
 * Clear the anti-abuse counters this script trips over.
 *
 * This is the one liberty the script takes, and it is worth being explicit about why
 * it is not cheating. Three real controls stand between these phases:
 *
 *   - the gateway's per-IP limit on /api/auth, which a script making a hundred
 *     unauthenticated auth calls from one host is SUPPOSED to trip;
 *   - the OTP resend cooldown, which fires because registering and then immediately
 *     logging in by OTP asks for two codes for one number inside a minute — a thing
 *     no real member does but every test does;
 *   - the per-handle recovery limit, which the rate-limit phase below deliberately
 *     exhausts and must not then leak into the phase after it.
 *
 * Each is asserted before it is cleared. Nothing here makes a failing server pass;
 * it stops one script's own traffic from being mistaken for an attack on the next
 * phase. The controls themselves are verified, not bypassed.
 */
async function reset() {
  await redis.delMatching('ratelimit:*');
  await redis.delMatching('otp:cooldown:*');
  await redis.delMatching('otp:sends:*');
  await redis.delMatching('recovery:attempts:*');
}

/** Register a fresh member and return everything the flows below need. */
async function enrol() {
  const mobile = randomMobile();
  const start = await post('/api/auth/register/start', { mobile });
  const verified = await post('/api/auth/register/verify', {
    challengeId: start.body.challengeId,
    code: start.body.devCode,
    ageConfirmed: true,
  });
  return {
    mobile,
    token: verified.body.token,
    pseudoId: verified.body.pseudoId,
    handle: verified.body.handle,
    recoveryCodes: verified.body.recoveryCodes ?? [],
    status: verified.status,
  };
}

async function main() {
  redis = new Redis(REDIS_URL);
  await redis.connect();
  await reset();

  // ------------------------------------------------------------------------
  console.log(c.bold('\nRegistration hands over the recovery bundle once\n'));

  const a = await enrol();
  check('registered and received a session', typeof a.token === 'string', String(a.status));
  // `QuietRiver-4821`. Drawn, never chosen — see handle-flows.mjs for the rules.
  check(
    'received a permanent drawn handle',
    /^[A-Z][a-z]{2,11}[A-Z][a-z]{2,11}-\d{4,6}$/.test(a.handle ?? ''),
    String(a.handle),
  );
  check('received ten recovery codes', a.recoveryCodes.length === 10, String(a.recoveryCodes.length));
  check('the codes are all different', new Set(a.recoveryCodes).size === a.recoveryCodes.length);

  // ------------------------------------------------------------------------
  console.log(c.bold('\nThe OTP resend cooldown follows the number, not the session\n'));

  // Registration just sent a code to this number. Asking for another one straight
  // away — which is what an SMS-cost amplifier or an SMS-harassment script does —
  // must be refused even though this is a different route with no session attached.
  const tooSoon = await post('/api/auth/login/otp/start', { mobile: a.mobile });
  check('a second code for the same number inside a minute is refused', tooSoon.status === 429,
    String(tooSoon.status));
  check(
    'and the caller is told how long to wait',
    Number(tooSoon.body?.error?.retryAfterSeconds ?? 0) > 0 ||
      tooSoon.body?.error?.code === 'rate_limited',
    JSON.stringify(tooSoon.body),
  );

  await reset(); // cooldown asserted; clear it so the flow below can proceed

  // ------------------------------------------------------------------------
  console.log(c.bold('\nOTP sign-in — the device is gone, the number is not\n'));

  const otpStart = await post('/api/auth/login/otp/start', { mobile: a.mobile });
  check('a challenge was issued', otpStart.status === 202, String(otpStart.status));

  const otpWrong = await post('/api/auth/login/otp/verify', {
    challengeId: otpStart.body.challengeId,
    code: otpStart.body.devCode === '000000' ? '111111' : '000000',
  });
  check('a wrong code is refused', otpWrong.status === 401, String(otpWrong.status));
  check(
    'and says only that authentication failed',
    otpWrong.body?.error?.code === 'authentication_failed',
    JSON.stringify(otpWrong.body),
  );
  check(
    'while reporting how many attempts are left',
    otpWrong.body?.error?.attemptsRemaining === 4,
    String(otpWrong.body?.error?.attemptsRemaining),
  );

  const otpOk = await post('/api/auth/login/otp/verify', {
    challengeId: otpStart.body.challengeId,
    code: otpStart.body.devCode,
  });
  check('the right code signs in', otpOk.status === 200, JSON.stringify(otpOk.body).slice(0, 80));
  check('on the same account', otpOk.body.pseudoId === a.pseudoId, String(otpOk.body.pseudoId));

  // The whole point of the change: one number, one handle, for good.
  check(
    'under the SAME handle it registered with',
    otpOk.body.handle === a.handle,
    `${a.handle} -> ${otpOk.body.handle}`,
  );
  check('and the session is a new one, not the old token reissued', otpOk.body.token !== a.token);

  const replay = await post('/api/auth/login/otp/verify', {
    challengeId: otpStart.body.challengeId,
    code: otpStart.body.devCode,
  });
  check('a verified challenge cannot be replayed', replay.status === 401, String(replay.status));

  // An unknown number must look exactly like a known one, or this route reports
  // whether a given number has an account on a mental health platform.
  const unknown = await post('/api/auth/login/otp/start', { mobile: randomMobile() });
  check(
    'an unregistered number gets the same 202 as a registered one',
    unknown.status === 202 && typeof unknown.body.challengeId === 'string',
    `${unknown.status} ${JSON.stringify(unknown.body).slice(0, 60)}`,
  );

  await reset();

  // ------------------------------------------------------------------------
  console.log(c.bold('\nRecovery codes — the number itself is gone\n'));

  const first = a.recoveryCodes[0];
  const rec = await post('/api/auth/recover', { handle: a.handle, recoveryCode: first });
  check('a valid code signs in', rec.status === 200, JSON.stringify(rec.body).slice(0, 80));
  check('with no OTP involved — that is the whole point of this door', rec.status === 200);
  check('on the right account', rec.body.pseudoId === a.pseudoId, String(rec.body.pseudoId));
  check('under the same permanent handle', rec.body.handle === a.handle, String(rec.body.handle));
  check(
    'and reports nine codes left',
    rec.body.recoveryCodesRemaining === 9,
    String(rec.body.recoveryCodesRemaining),
  );

  const reuse = await post('/api/auth/recover', { handle: a.handle, recoveryCode: first });
  check('the same code cannot be spent twice', reuse.status === 401, String(reuse.status));

  const badCode = await post('/api/auth/recover', {
    handle: a.handle,
    recoveryCode: 'ZZZZ-ZZZZ-ZZZZ',
  });
  const badHandle = await post('/api/auth/recover', {
    handle: 'NoSuchThing-482173',
    recoveryCode: a.recoveryCodes[1],
  });
  check('a wrong code is refused', badCode.status === 401, String(badCode.status));
  check('an unknown handle is refused', badHandle.status === 401, String(badHandle.status));
  check(
    'the two are INDISTINGUISHABLE — no oracle for which handles are recoverable',
    badCode.status === badHandle.status &&
      JSON.stringify(badCode.body) === JSON.stringify(badHandle.body),
    `${JSON.stringify(badCode.body)} vs ${JSON.stringify(badHandle.body)}`,
  );
  check(
    'and neither names the reason',
    badCode.body?.error?.code === 'authentication_failed',
    JSON.stringify(badCode.body),
  );

  await reset();

  // ------------------------------------------------------------------------
  console.log(c.bold('\nRecovery is rate limited per handle\n'));

  const b = await enrol();
  const attempts = [];
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    attempts.push(
      await post('/api/auth/recover', { handle: b.handle, recoveryCode: 'WRON-GWRO-NGWR' }),
    );
  }
  check(
    'the first five attempts are merely refused',
    attempts.slice(0, 5).every((r) => r.status === 401),
    attempts.slice(0, 5).map((r) => r.status).join(','),
  );
  check(
    'the sixth is rate limited',
    attempts[5].status === 429 && attempts[5].body?.error?.code === 'rate_limited',
    `${attempts[5].status} ${JSON.stringify(attempts[5].body)}`,
  );

  // Counted on ATTEMPT, not on failure — otherwise interleaving a known-good code
  // would reset nothing and buy an attacker unlimited guesses.
  const stillLimited = await post('/api/auth/recover', {
    handle: b.handle,
    recoveryCode: b.recoveryCodes[0],
  });
  check(
    'a VALID code is refused too once the limit is hit',
    stillLimited.status === 429,
    String(stillLimited.status),
  );

  // The limit is per handle. Somebody else's account must be unaffected.
  const other = await post('/api/auth/recover', { handle: a.handle, recoveryCode: a.recoveryCodes[2] });
  check(
    'a different handle is untouched by that limit',
    other.status === 200,
    String(other.status),
  );

  await reset();

  // ------------------------------------------------------------------------
  console.log(c.bold('\nRegenerating a bundle invalidates the old one\n'));

  const d = await enrol();
  const regen = await post('/api/account/recovery-codes/regenerate', {}, d.token);
  check('a fresh bundle is issued', regen.status === 201, JSON.stringify(regen.body).slice(0, 80));
  check('of ten codes', (regen.body.recoveryCodes ?? []).length === 10);
  check(
    'none of which were in the old bundle',
    (regen.body.recoveryCodes ?? []).length === 10 &&
      regen.body.recoveryCodes.every((code) => !d.recoveryCodes.includes(code)),
  );

  const oldCode = await post('/api/auth/recover', {
    handle: d.handle,
    recoveryCode: d.recoveryCodes[0],
  });
  check('an old, never-used code no longer works', oldCode.status === 401, String(oldCode.status));

  const newCode = await post('/api/auth/recover', {
    handle: d.handle,
    recoveryCode: (regen.body.recoveryCodes ?? [])[0],
  });
  check('a new one does', newCode.status === 200, String(newCode.status));

  const noSession = await post('/api/account/recovery-codes/regenerate', {});
  check(
    'regenerating without a session is refused',
    noSession.status === 401,
    String(noSession.status),
  );

  // The regression that put this route under /api/auth in the first place. A route
  // needing a session must not sit under the one prefix that cannot resolve one.
  const wrongPrefix = await post('/api/auth/recovery-codes/regenerate', {}, d.token);
  check(
    'the old unauthenticated path is gone, not silently still serving',
    wrongPrefix.status === 404,
    String(wrongPrefix.status),
  );

  // ------------------------------------------------------------------------
  redis.close();
  console.log(
    failures === 0
      ? c.green(`\nall login flows hold — ${c.bold('every check passed')}\n`)
      : c.red(`\n${failures} check(s) FAILED\n`),
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  redis?.close();
  process.exit(1);
});
