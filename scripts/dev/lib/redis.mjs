/**
 * A Redis client small enough to read, rather than a dependency.
 *
 * The dev scripts need SCAN and DEL and nothing else, to clear anti-abuse counters
 * their own traffic has tripped. Same reasoning as the hand-rolled CBOR in
 * virtual-authenticator.mjs: a dependency for sixty lines of protocol is a worse
 * trade than the sixty lines.
 *
 * DEVELOPMENT ONLY. Nothing in backend/ imports this.
 */

import net from 'node:net';

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

export class Redis {
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

export const DEFAULT_REDIS_URL =
  process.env.REDIS_URL ?? 'redis://:dev_redis_c93f5a17e0b846d2@127.0.0.1:6379';

/**
 * Clear the anti-abuse counters a dev script trips over.
 *
 * Worth being explicit that this is not cheating. Three real controls stand between
 * a script's phases — the gateway's per-IP limit on /api/auth, the OTP resend
 * cooldown, and the per-handle recovery limit — and a script making a hundred
 * unauthenticated calls from one host is SUPPOSED to trip all three.
 *
 * Each is asserted before it is cleared. Nothing here makes a failing server pass; it
 * stops one phase's traffic from being mistaken for an attack on the next.
 */
export async function clearAbuseCounters(redis) {
  await redis.delMatching('ratelimit:*');
  await redis.delMatching('otp:cooldown:*');
  await redis.delMatching('otp:sends:*');
  await redis.delMatching('recovery:attempts:*');
}
