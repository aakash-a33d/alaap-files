#!/usr/bin/env node
/**
 * A virtual WebAuthn authenticator.
 *
 * Exercises the passkey flows end to end without a browser, a device, or a human
 * touching a fingerprint reader. Chrome's DevTools virtual authenticator does the
 * same job interactively; this one runs in CI and in a terminal.
 *
 * It implements the authenticator half honestly — a real P-256 key pair, a real
 * signature over the real signed bytes — so a server bug that would let an invalid
 * assertion through will fail here too. It is NOT a stub that returns success.
 *
 * DEVELOPMENT ONLY. It mints credentials from nothing, which is precisely what an
 * attacker would want, and it lives in scripts/dev/ rather than anywhere a
 * deployment could reach.
 *
 *   node scripts/dev/virtual-authenticator.mjs
 */

import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (s) => Buffer.from(s, 'base64url');

// ----------------------------------------------------------------- CBOR ---
//
// Only the two shapes WebAuthn needs: the `none` attestation object and a COSE
// EC2 key. A full CBOR encoder would be a dependency for six lines of output.

function cborText(s) {
  const bytes = Buffer.from(s, 'utf8');
  return Buffer.concat([Buffer.from([0x60 | bytes.length]), bytes]);
}

function cborBytes(buf) {
  if (buf.length < 24) return Buffer.concat([Buffer.from([0x40 | buf.length]), buf]);
  if (buf.length < 256) return Buffer.concat([Buffer.from([0x58, buf.length]), buf]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(buf.length);
  return Buffer.concat([Buffer.from([0x59]), len, buf]);
}

/** COSE_Key for ES256: {1:2, 3:-7, -1:1, -2:x, -3:y} */
function coseKey(x, y) {
  return Buffer.concat([
    Buffer.from([0xa5]),
    Buffer.from([0x01, 0x02]), // kty: EC2
    Buffer.from([0x03, 0x26]), // alg: ES256 (-7)
    Buffer.from([0x20, 0x01]), // crv: P-256
    Buffer.from([0x21]), cborBytes(x), // x
    Buffer.from([0x22]), cborBytes(y), // y
  ]);
}

/** {fmt:"none", attStmt:{}, authData:<bytes>} */
function attestationObject(authData) {
  return Buffer.concat([
    Buffer.from([0xa3]),
    cborText('fmt'), cborText('none'),
    cborText('attStmt'), Buffer.from([0xa0]),
    cborText('authData'), cborBytes(authData),
  ]);
}

// --------------------------------------------------------- authenticator ---

const FLAG_UP = 0x01; // user present
const FLAG_UV = 0x04; // user verified
const FLAG_AT = 0x40; // attested credential data included

export class VirtualAuthenticator {
  constructor({ aaguid = Buffer.alloc(16), signCount = 0 } = {}) {
    this.aaguid = aaguid;
    this.signCount = signCount;
    this.credentials = new Map();
  }

  #clientData(type, challenge, origin) {
    return Buffer.from(
      JSON.stringify({ type, challenge, origin, crossOrigin: false }),
      'utf8',
    );
  }

  #authData(rpId, flags, credentialId, coseKeyBytes) {
    const rpIdHash = createHash('sha256').update(rpId, 'utf8').digest();
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.signCount);

    const parts = [rpIdHash, Buffer.from([flags]), counter];
    if (credentialId !== undefined) {
      const idLen = Buffer.alloc(2);
      idLen.writeUInt16BE(credentialId.length);
      parts.push(this.aaguid, idLen, credentialId, coseKeyBytes);
    }
    return Buffer.concat(parts);
  }

  /** navigator.credentials.create() */
  create({ challenge, origin, rpId, userId }) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' });
    const x = fromB64url(jwk.x);
    const y = fromB64url(jwk.y);

    const credentialId = randomBytes(32);
    this.signCount += 1;

    const clientDataJSON = this.#clientData('webauthn.create', challenge, origin);
    const authData = this.#authData(
      rpId,
      FLAG_UP | FLAG_UV | FLAG_AT,
      credentialId,
      coseKey(x, y),
    );

    this.credentials.set(b64url(credentialId), { privateKey, userId });

    return {
      id: b64url(credentialId),
      rawId: b64url(credentialId),
      type: 'public-key',
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(attestationObject(authData)),
        transports: ['internal', 'hybrid'],
      },
    };
  }

  /**
   * navigator.credentials.get()
   *
   * `counterOverride` drives the clone-detection path: pass a value at or below what
   * the server already stored, which is what a cloned authenticator or a replayed
   * assertion looks like from the server's side.
   */
  get({ challenge, origin, rpId, credentialId, counterOverride }) {
    const entry = this.credentials.get(credentialId);
    if (entry === undefined) throw new Error(`no such credential: ${credentialId}`);

    this.signCount = counterOverride ?? this.signCount + 1;
    if (this.signCount < 0) throw new Error('signCount cannot be negative');

    const clientDataJSON = this.#clientData('webauthn.get', challenge, origin);
    const authData = this.#authData(rpId, FLAG_UP | FLAG_UV);

    // The signed bytes: authenticatorData || SHA-256(clientDataJSON).
    const signed = Buffer.concat([
      authData,
      createHash('sha256').update(clientDataJSON).digest(),
    ]);
    const signature = createSign('sha256').update(signed).sign(entry.privateKey);

    return {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        userHandle: b64url(entry.userId),
      },
    };
  }
}

// ------------------------------------------------------------------ demo ---

const GATEWAY = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8080';
const ORIGIN = process.env.EXPECTED_ORIGIN ?? 'http://localhost:5173';
const RP_ID = process.env.RP_ID ?? 'localhost';

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
  green: (s) => `[32m${s}[0m`,
  red: (s) => `[31m${s}[0m`,
  dim: (s) => `[2m${s}[0m`,
  bold: (s) => `[1m${s}[0m`,
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

async function main() {
  const authenticator = new VirtualAuthenticator();

  console.log(c.bold('\nRegister a member by OTP\n'));
  const start = await post('/api/auth/register/start', {
    mobile: `9${String(Math.floor(Math.random() * 900000000) + 100000000)}`,
  });
  const verified = await post('/api/auth/register/verify', {
    challengeId: start.body.challengeId,
    code: start.body.devCode,
    ageConfirmed: true,
  });
  const token = verified.body.token;
  check('registered and received a session', typeof token === 'string', String(verified.status));
  console.log(c.dim(`        handle ${verified.body.handle}`));

  console.log(c.bold('\nEnrol a passkey\n'));
  const regStart = await post('/api/passkeys/register/start', {}, token);
  check('register/start returned options', regStart.status === 200, String(regStart.status));

  const options = regStart.body.options;
  check(
    'the OS picker will show the public handle, not a phone number',
    options.user.name === verified.body.handle,
    options.user?.name,
  );
  check('no attestation is requested for a member', options.attestation === 'none');

  const attestation = authenticator.create({
    challenge: options.challenge,
    origin: ORIGIN,
    rpId: RP_ID,
    userId: fromB64url(options.user.id),
  });

  const regFinish = await post(
    '/api/passkeys/register/finish',
    { challengeId: regStart.body.challengeId, response: attestation, label: 'Virtual device' },
    token,
  );
  check('register/finish verified the attestation', regFinish.status === 201, JSON.stringify(regFinish.body));

  console.log(c.bold('\nThe challenge is single-use\n'));
  const replay = await post(
    '/api/passkeys/register/finish',
    { challengeId: regStart.body.challengeId, response: attestation },
    token,
  );
  check('replaying the same challenge is refused', replay.status === 400, String(replay.status));

  console.log(c.bold('\nLog in with the passkey — no phone number\n'));
  const loginStart = await post('/api/auth/login/start', {});
  check('login/start returned a challenge', loginStart.status === 200, String(loginStart.status));
  check(
    'allowCredentials is empty, so the response reveals no accounts',
    (loginStart.body.options.allowCredentials ?? []).length === 0,
  );

  const assertion = authenticator.get({
    challenge: loginStart.body.options.challenge,
    origin: ORIGIN,
    rpId: RP_ID,
    credentialId: attestation.id,
  });
  const loginFinish = await post('/api/auth/login/finish', {
    challengeId: loginStart.body.challengeId,
    response: assertion,
  });
  check('login/finish minted a session', loginFinish.status === 200, JSON.stringify(loginFinish.body));
  check(
    'it resolved the same member',
    loginFinish.body.pseudoId === verified.body.pseudoId,
    `${loginFinish.body.pseudoId} vs ${verified.body.pseudoId}`,
  );

  console.log(c.bold('\nThe gateway accepts the passkey session\n'));
  const me = await fetch(`${GATEWAY}/api/pseudonym/me`, {
    headers: { authorization: `Bearer ${loginFinish.body.token}` },
  });
  check('GET /api/pseudonym/me returns 200', me.status === 200, String(me.status));

  console.log(c.bold('\nA tampered assertion is refused\n'));
  const ls2 = await post('/api/auth/login/start', {});
  const good = authenticator.get({
    challenge: ls2.body.options.challenge,
    origin: ORIGIN,
    rpId: RP_ID,
    credentialId: attestation.id,
  });
  // Flip a byte of the signature. Everything else stays valid.
  const sig = fromB64url(good.response.signature);
  sig[sig.length - 1] ^= 0xff;
  const tampered = { ...good, response: { ...good.response, signature: b64url(sig) } };
  const bad = await post('/api/auth/login/finish', {
    challengeId: ls2.body.challengeId,
    response: tampered,
  });
  check('a forged signature is rejected', bad.status === 401, String(bad.status));

  console.log(c.bold('\nA replayed assertion is refused\n'));
  const ls3 = await post('/api/auth/login/start', {});
  const replayed = authenticator.get({
    challenge: ls3.body.options.challenge,
    origin: ORIGIN,
    rpId: RP_ID,
    credentialId: attestation.id,
    // Rewound below whatever the server has stored — what a cloned authenticator,
    // or a replayed assertion, looks like from the server's side.
    counterOverride: 1,
  });
  const cloned = await post('/api/auth/login/finish', {
    challengeId: ls3.body.challengeId,
    response: replayed,
  });
  check('a regressed signature counter is rejected', cloned.status === 401, String(cloned.status));

  console.log(
    `\n${failures === 0 ? c.green('all passkey flows hold') : c.red(`${failures} failure(s)`)}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(c.red('\nvirtual authenticator failed:'), err);
  process.exit(1);
});
