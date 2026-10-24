#!/usr/bin/env node
/**
 * End-to-end check of trusted devices.
 *
 * "Where am I signed in, and how do I stop that one?"
 *
 * On this platform that question is a safety feature before it is a convenience. The
 * person reading somebody's account without permission is more often in the same
 * house than on the other side of the world, so the checks here are mostly about the
 * two properties that make the answer trustworthy:
 *
 *   - a device GRANTS nothing. Revoking it ends sessions; it never lets one start.
 *   - one account can never see, rename, or sign out another account's devices,
 *     and the table cannot reveal that two accounts share a handset.
 *
 * DEVELOPMENT ONLY: reads `devCode` from the OTP response, and clears anti-abuse
 * counters between phases. See lib/redis.mjs.
 *
 *   node scripts/dev/device-flows.mjs
 */

import { randomBytes } from 'node:crypto';

import { Redis, DEFAULT_REDIS_URL, clearAbuseCounters } from './lib/redis.mjs';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8080';

/** What a real client generates once and keeps. 32 random bytes, base64url. */
const newDeviceKey = () => randomBytes(32).toString('base64url');

const UA = {
  phone: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 Mobile Safari/537.36',
  laptop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15',
};

async function call(method, path, body, token, userAgent) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
      ...(userAgent !== undefined ? { 'user-agent': userAgent } : {}),
    },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const post = (p, b, t, ua) => call('POST', p, b, t, ua);
const get = (p, t) => call('GET', p, undefined, t);

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

/** Register a member, signing in from `deviceKey` with `userAgent`. */
async function enrol(deviceKey, userAgent) {
  const mobile = randomMobile();
  const start = await post('/api/auth/register/start', { mobile });
  const verified = await post(
    '/api/auth/register/verify',
    { challengeId: start.body.challengeId, code: start.body.devCode, ageConfirmed: true, deviceKey },
    undefined,
    userAgent,
  );
  return {
    mobile,
    token: verified.body.token,
    handle: verified.body.handle,
    recoveryCodes: verified.body.recoveryCodes ?? [],
    status: verified.status,
  };
}

/** Sign in again by OTP from a given device. */
async function signInFrom(mobile, deviceKey, userAgent) {
  await clearAbuseCounters(redis);
  const start = await post('/api/auth/login/otp/start', { mobile });
  return post(
    '/api/auth/login/otp/verify',
    { challengeId: start.body.challengeId, code: start.body.devCode, deviceKey },
    undefined,
    userAgent,
  );
}

async function main() {
  redis = new Redis(DEFAULT_REDIS_URL);
  await redis.connect();
  await clearAbuseCounters(redis);

  // ------------------------------------------------------------------------
  console.log(c.bold('\nSigning in records the device it happened on\n'));

  const phoneKey = newDeviceKey();
  const a = await enrol(phoneKey, UA.phone);
  check('registered', typeof a.token === 'string', String(a.status));

  let list = await get('/api/account/devices', a.token);
  check('the device list has one entry', list.body.devices?.length === 1,
    JSON.stringify(list.body).slice(0, 100));
  check(
    'labelled from the user-agent, coarsely',
    list.body.devices?.[0]?.label === 'Android phone',
    String(list.body.devices?.[0]?.label),
  );
  check('and marked as the one being used right now', list.body.devices?.[0]?.current === true);
  check('with a live session on it', list.body.devices?.[0]?.activeSessions === 1,
    String(list.body.devices?.[0]?.activeSessions));

  // ------------------------------------------------------------------------
  console.log(c.bold('\nA second device appears as a second device\n'));

  const laptopKey = newDeviceKey();
  const fromLaptop = await signInFrom(a.mobile, laptopKey, UA.laptop);
  check('signed in from a laptop', fromLaptop.status === 200, String(fromLaptop.status));

  list = await get('/api/account/devices', a.token);
  const labels = (list.body.devices ?? []).map((d) => d.label).sort();
  check('now two devices', list.body.devices?.length === 2, JSON.stringify(labels));
  check('one phone, one computer', labels.join(',') === 'Android phone,Windows computer',
    labels.join(','));

  // The same browser signing in twice must NOT look like two devices — otherwise the
  // list fills with duplicates and the row that matters gets lost in them.
  const againFromPhone = await signInFrom(a.mobile, phoneKey, UA.phone);
  check('signing in again from the phone re-uses its row', againFromPhone.status === 200);
  list = await get('/api/account/devices', a.token);
  check('still two devices, not three', list.body.devices?.length === 2,
    String(list.body.devices?.length));

  const phone = list.body.devices.find((d) => d.label === 'Android phone');
  const laptop = list.body.devices.find((d) => d.label === 'Windows computer');
  check('the phone now shows two live sessions', phone?.activeSessions === 2,
    String(phone?.activeSessions));

  // ------------------------------------------------------------------------
  console.log(c.bold('\nRenaming is the member’s own note to themselves\n'));

  const renamed = await post(
    '/api/account/devices/rename',
    { deviceId: laptop.id, label: "Ma's laptop" },
    a.token,
  );
  check('a device can be renamed', renamed.status === 204, String(renamed.status));
  list = await get('/api/account/devices', a.token);
  check(
    'and keeps the new name',
    list.body.devices.some((d) => d.label === "Ma's laptop"),
    JSON.stringify(list.body.devices.map((d) => d.label)),
  );

  const emptyName = await post(
    '/api/account/devices/rename',
    { deviceId: laptop.id, label: '   ' },
    a.token,
  );
  check('a blank name is refused', emptyName.status === 422, String(emptyName.status));

  // ------------------------------------------------------------------------
  console.log(c.bold('\nSigning a device out ends its sessions\n'));

  const laptopToken = fromLaptop.body.token;
  const laptopWorks = await get('/api/pseudonym/me', laptopToken);
  check('the laptop session works before revocation', laptopWorks.status === 200,
    String(laptopWorks.status));

  const revoked = await post('/api/account/devices/revoke', { deviceId: laptop.id }, a.token);
  check('the device is revoked', revoked.status === 200, JSON.stringify(revoked.body));
  check('and its session count is reported', revoked.body.sessionsEnded === 1,
    String(revoked.body.sessionsEnded));

  const laptopDead = await get('/api/pseudonym/me', laptopToken);
  check('the laptop session is now dead', laptopDead.status === 401, String(laptopDead.status));

  const phoneAlive = await get('/api/pseudonym/me', a.token);
  check('the phone session is untouched', phoneAlive.status === 200, String(phoneAlive.status));

  list = await get('/api/account/devices', a.token);
  check('and the revoked device leaves the list', list.body.devices?.length === 1,
    String(list.body.devices?.length));

  const revokeAgain = await post('/api/account/devices/revoke', { deviceId: laptop.id }, a.token);
  check('revoking it twice is refused the same way as an unknown device',
    revokeAgain.status === 404, String(revokeAgain.status));

  // ------------------------------------------------------------------------
  console.log(c.bold('\nA revoked device is signed out, not barred\n'));

  // The honest consequence of a device not being a credential. Somebody who can still
  // pass authentication gets back in — and the member needs to know that, because the
  // real control is revoking the passkey or the number, not the device.
  const backAgain = await signInFrom(a.mobile, laptopKey, UA.laptop);
  check('the same browser can sign in again after a full authentication',
    backAgain.status === 200, String(backAgain.status));
  list = await get('/api/account/devices', a.token);
  check('and reappears in the list', list.body.devices?.length === 2,
    String(list.body.devices?.length));

  // ------------------------------------------------------------------------
  console.log(c.bold('\nSign out everywhere else keeps only this one\n'));

  const others = await post('/api/account/devices/revoke-others', {}, a.token);
  check('other devices are ended', others.status === 200 && others.body.devicesEnded >= 1,
    JSON.stringify(others.body));

  const stillHere = await get('/api/pseudonym/me', a.token);
  check('this session survives', stillHere.status === 200, String(stillHere.status));
  check('the other one does not',
    (await get('/api/pseudonym/me', backAgain.body.token)).status === 401);

  // ------------------------------------------------------------------------
  console.log(c.bold('\nOne account can never reach another account’s devices\n'));

  const b = await enrol(newDeviceKey(), UA.mac);
  const bList = await get('/api/account/devices', b.token);
  check('a second member sees only their own device', bList.body.devices?.length === 1,
    String(bList.body.devices?.length));

  const bDeviceId = bList.body.devices[0].id;
  const crossRevoke = await post('/api/account/devices/revoke', { deviceId: bDeviceId }, a.token);
  check('member A cannot revoke member B’s device', crossRevoke.status === 404,
    String(crossRevoke.status));
  const crossRename = await post(
    '/api/account/devices/rename',
    { deviceId: bDeviceId, label: 'not yours' },
    a.token,
  );
  check('nor rename it', crossRename.status === 404, String(crossRename.status));
  check(
    'and B’s session is still alive',
    (await get('/api/pseudonym/me', b.token)).status === 200,
  );

  // THE property the account-scoped hash exists for. The same physical device —
  // the same deviceKey — used on two accounts must produce two unrelated rows, so
  // the table cannot answer "which accounts share a handset?"
  const shared = newDeviceKey();
  const one = await enrol(shared, UA.phone);
  const two = await enrol(shared, UA.phone);
  const oneList = await get('/api/account/devices', one.token);
  const twoList = await get('/api/account/devices', two.token);
  check(
    'the same device key on two accounts yields two unrelated device ids',
    oneList.body.devices?.[0]?.id !== undefined &&
      oneList.body.devices[0].id !== twoList.body.devices?.[0]?.id,
    `${oneList.body.devices?.[0]?.id} vs ${twoList.body.devices?.[0]?.id}`,
  );
  check(
    'and neither account can see the other’s',
    oneList.body.devices?.length === 1 && twoList.body.devices?.length === 1,
  );

  // ------------------------------------------------------------------------
  console.log(c.bold('\nDevice bookkeeping never blocks a sign-in\n'));

  const noKey = await enrol(undefined, UA.phone);
  check('a client that sends no device key still registers', typeof noKey.token === 'string',
    String(noKey.status));
  check('and simply has an empty device list',
    (await get('/api/account/devices', noKey.token)).body.devices?.length === 0);

  const badKey = await enrol('9123456780', UA.phone);
  check('a malformed device key is refused at the schema', badKey.status === 400,
    String(badKey.status));

  const anon = await get('/api/account/devices');
  check('the device list needs a session', anon.status === 401, String(anon.status));

  // ------------------------------------------------------------------------
  redis.close();
  console.log(
    failures === 0
      ? c.green(`\nall device flows hold — ${c.bold('every check passed')}\n`)
      : c.red(`\n${failures} check(s) FAILED\n`),
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  redis?.close();
  process.exit(1);
});
