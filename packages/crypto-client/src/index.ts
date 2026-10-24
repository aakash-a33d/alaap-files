/**
 * Envelope encryption against OpenBao Transit (§12F).
 *
 * WHAT GOES WHERE, AND WHY IT IS SPLIT
 *
 *   the body        encrypted here, with AES-256-GCM, under a key used once
 *   the DEK         that one-time key, wrapped by Transit
 *   Transit         never sees the body. Only ever the 32-byte DEK.
 *
 * So a stolen database yields ciphertext and wrapped keys it cannot unwrap. A
 * compromised OpenBao yields the ability to unwrap keys for ciphertext it does not
 * have. Reading a journal entry needs both, which is the whole arrangement.
 *
 * A DEK IS USED ONCE AND THROWN AWAY
 *
 * Per record, not per member and not per service. Two records never share a key, so
 * one leaked DEK discloses exactly one entry — and GCM's nonce-reuse catastrophe
 * cannot happen across records, because there is nothing to reuse.
 *
 * WHY THE KEY VERSION IS STORED PER ROW
 *
 * Rotating a Transit key adds a version and keeps the old ones. A record wrapped by
 * version 3 stays readable after a rotation to version 4, and nothing needs
 * re-encrypting. `key_version` beside the ciphertext is what buys that.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/** AES-256-GCM. 12-byte nonce is the standard for GCM; 16-byte tag is its full length. */
const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const DEK_BYTES = 32;

export interface Envelope {
  /** nonce ‖ ciphertext ‖ tag. One buffer, because they are useless apart. */
  ciphertext: Buffer;
  /** The DEK as Transit returned it: `vault:v3:...`. Opaque, and not a key. */
  wrappedDek: Buffer;
  keyId: string;
  keyVersion: number;
}

export class CryptoError extends Error {
  readonly reason: string;

  constructor(reason: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CryptoError';
    this.reason = reason;
  }
}

export interface TransitOptions {
  /** Base URL of OpenBao, e.g. http://127.0.0.1:8200 */
  address: string;
  token: string;
  /** Transit key name, e.g. `alaap-clinical`. One per vault; see provision-keys.mjs. */
  keyId: string;
  timeoutMs?: number;
}

/**
 * Wraps and unwraps DEKs. Holds no key material of its own.
 *
 * One instance per vault, because one Transit key per vault: a service given the
 * clinical client cannot unwrap an identity record's DEK even if it obtained one.
 */
export class TransitClient {
  private readonly address: string;
  private readonly token: string;
  readonly keyId: string;
  private readonly timeoutMs: number;

  constructor(options: TransitOptions) {
    this.address = options.address.replace(/\/+$/, '');
    this.token = options.token;
    this.keyId = options.keyId;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  private async call(path: string, body: unknown): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.address}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-vault-token': this.token },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        // The response body can carry the key name and the token's policy. Neither
        // belongs in a log line, so only the status travels.
        throw new CryptoError('transit_refused', `transit returned ${response.status}`);
      }
      const parsed = (await response.json()) as { data?: Record<string, unknown> };
      if (parsed.data === undefined) throw new CryptoError('transit_malformed', 'no data in reply');
      return parsed.data;
    } catch (cause) {
      if (cause instanceof CryptoError) throw cause;
      throw new CryptoError('transit_unreachable', 'could not reach transit', { cause });
    } finally {
      clearTimeout(timer);
    }
  }

  async wrap(dek: Buffer): Promise<{ wrapped: Buffer; version: number }> {
    const data = await this.call(`/v1/transit/encrypt/${this.keyId}`, {
      plaintext: dek.toString('base64'),
    });
    const wrapped = String(data.ciphertext ?? '');
    // `vault:v3:...` — the version is in the string, and is parsed out rather than
    // asked for separately so the two can never disagree about which key wrapped this.
    const match = /^vault:v(\d+):/.exec(wrapped);
    if (match === null) {
      throw new CryptoError('transit_malformed', 'wrapped DEK has no version prefix');
    }
    return { wrapped: Buffer.from(wrapped, 'utf8'), version: Number(match[1]) };
  }

  async unwrap(wrapped: Buffer): Promise<Buffer> {
    const data = await this.call(`/v1/transit/decrypt/${this.keyId}`, {
      ciphertext: wrapped.toString('utf8'),
    });
    const dek = Buffer.from(String(data.plaintext ?? ''), 'base64');
    if (dek.length !== DEK_BYTES) {
      throw new CryptoError('bad_dek', `unwrapped key is ${dek.length} bytes, expected ${DEK_BYTES}`);
    }
    return dek;
  }
}

/**
 * Encrypt a payload. The DEK exists for the length of this function and no longer.
 *
 * `aad` binds the ciphertext to something outside it — the record id — so a row's
 * ciphertext cannot be moved onto a different row and still decrypt. Without it, an
 * attacker with write access could swap one member's journal entry for another's and
 * every integrity check would pass.
 */
export async function seal(
  plaintext: string,
  transit: TransitClient,
  aad?: string,
): Promise<Envelope> {
  const dek = randomBytes(DEK_BYTES);
  try {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(ALGORITHM, dek, nonce);
    if (aad !== undefined) cipher.setAAD(Buffer.from(aad, 'utf8'));

    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    const { wrapped, version } = await transit.wrap(dek);
    return {
      ciphertext: Buffer.concat([nonce, body, tag]),
      wrappedDek: wrapped,
      keyId: transit.keyId,
      keyVersion: version,
    };
  } finally {
    // Not a guarantee — the runtime may have copied it — but it removes the obvious
    // copy, and costs nothing.
    dek.fill(0);
  }
}

/**
 * Decrypt a payload. Throws rather than returning a partial result.
 *
 * A tag mismatch means the ciphertext was altered, truncated, or does not belong to
 * this record. All three are the same answer: this is not readable, and returning
 * anything at all would be returning something nobody wrote.
 */
export async function open(
  envelope: Pick<Envelope, 'ciphertext' | 'wrappedDek'>,
  transit: TransitClient,
  aad?: string,
): Promise<string> {
  if (envelope.ciphertext.length < NONCE_BYTES + TAG_BYTES) {
    throw new CryptoError('truncated', 'ciphertext is too short to contain a nonce and a tag');
  }

  const dek = await transit.unwrap(envelope.wrappedDek);
  try {
    const nonce = envelope.ciphertext.subarray(0, NONCE_BYTES);
    const tag = envelope.ciphertext.subarray(envelope.ciphertext.length - TAG_BYTES);
    const body = envelope.ciphertext.subarray(NONCE_BYTES, envelope.ciphertext.length - TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, dek, nonce);
    decipher.setAuthTag(tag);
    if (aad !== undefined) decipher.setAAD(Buffer.from(aad, 'utf8'));

    try {
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch (cause) {
      throw new CryptoError('tampered', 'ciphertext failed authentication', { cause });
    }
  } finally {
    dek.fill(0);
  }
}

/**
 * A DEK the platform cannot unwrap, for maximum-privacy records.
 *
 * Under maximum privacy the DEK is wrapped by a key that exists only on the member's
 * device, and the platform stores an opaque blob. `open` cannot read these and is not
 * meant to: the audit registry says as much — "Maximum Privacy records never produce
 * [clinical.record.decrypted] because the platform holds no key for them."
 *
 * Until the client-side key infrastructure exists, this is the honest shape of it:
 * the platform can store such a record and can prove it cannot read one.
 */
export function isPlatformReadable(privacyMode: string): boolean {
  return privacyMode === 'standard';
}

/** Constant-time compare, for anywhere a caller-supplied digest meets a stored one. */
export function equals(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
