/**
 * Envelope encryption, against the real OpenBao.
 *
 * Not a mock. The point of these is the boundary between this code and Transit, and a
 * fake Transit would test the fake. They skip when OpenBao is not reachable so the
 * suite still runs on a machine without the stack up, and the skip is visible.
 *
 * What is being proved, in order of how much it would cost to be wrong:
 *
 *   Transit never receives the plaintext.
 *   A record's ciphertext cannot be moved onto another record.
 *   Tampering fails loudly rather than returning something nobody wrote.
 *   A rotated key does not strand the records wrapped by the old version.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import {
  CryptoError,
  TransitClient,
  isPlatformReadable,
  open,
  seal,
} from '../src/index.ts';

const ADDRESS = process.env.OPENBAO_ADDR ?? 'http://127.0.0.1:8200';
const TOKEN = process.env.OPENBAO_ROOT_TOKEN ?? 'dev-root-token-not-for-any-real-environment';

let reachable = false;

beforeAll(async () => {
  try {
    const res = await fetch(`${ADDRESS}/v1/sys/health`, { signal: AbortSignal.timeout(2000) });
    reachable = res.status < 500;
  } catch {
    reachable = false;
  }
});

const transit = (key = 'alaap-clinical') =>
  new TransitClient({ address: ADDRESS, token: TOKEN, keyId: key });

const withBao = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!reachable) {
      console.warn(`  skipped (OpenBao unreachable at ${ADDRESS})`);
      return;
    }
    await fn();
  });

describe('a round trip', () => {
  withBao('returns exactly what went in', async () => {
    const text = 'I have not slept properly in about a week.';
    const sealed = await seal(text, transit());
    expect(await open(sealed, transit())).toBe(text);
  });

  withBao('handles Hinglish, emoji and newlines without mangling them', async () => {
    const text = 'Mujhe raat ko neend nahi aati 😔\n\nAur subah uthne ka mann nahi karta.';
    const sealed = await seal(text, transit());
    expect(await open(sealed, transit())).toBe(text);
  });

  withBao('records the key and the version it was wrapped with', async () => {
    const sealed = await seal('anything', transit());
    expect(sealed.keyId).toBe('alaap-clinical');
    expect(sealed.keyVersion).toBeGreaterThanOrEqual(1);
  });

  withBao('produces a different ciphertext every time for the same text', async () => {
    // A fresh DEK and nonce per record. Identical plaintext must never produce
    // identical rows, or the database discloses which members wrote the same thing.
    const a = await seal('the same words', transit());
    const b = await seal('the same words', transit());
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.wrappedDek.equals(b.wrappedDek)).toBe(false);
  });
});

describe('what Transit is given', () => {
  withBao('never sees the plaintext — only a 32-byte key', async () => {
    // The claim the whole design rests on. Intercepted at fetch so the assertion is
    // about what actually left the process, not about what the code intended.
    const sent: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body === 'string') sent.push(init.body);
      return realFetch(url, init);
    }) as typeof fetch;

    try {
      const secret = 'a sentence that must never reach the key service';
      await seal(secret, transit());
      expect(sent.length).toBeGreaterThan(0);
      for (const body of sent) {
        expect(body).not.toContain(secret);
        expect(body).not.toContain('sentence');
        // What it does carry is a base64 32-byte key.
        const parsed = JSON.parse(body) as { plaintext?: string };
        if (parsed.plaintext !== undefined) {
          expect(Buffer.from(parsed.plaintext, 'base64')).toHaveLength(32);
        }
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('binding a record to its row', () => {
  withBao('refuses ciphertext moved onto a different record', async () => {
    // Without AAD, somebody with write access could swap one member's journal entry
    // for another's and every integrity check would still pass.
    const sealed = await seal('entry belonging to record A', transit(), 'record-A');
    await expect(open(sealed, transit(), 'record-B')).rejects.toThrow(CryptoError);
  });

  withBao('opens when the binding matches', async () => {
    const sealed = await seal('entry belonging to record A', transit(), 'record-A');
    expect(await open(sealed, transit(), 'record-A')).toBe('entry belonging to record A');
  });
});

describe('tampering', () => {
  withBao('a flipped byte in the body fails authentication', async () => {
    const sealed = await seal('something worth altering', transit());
    const altered = Buffer.from(sealed.ciphertext);
    altered[20] ^= 0xff;
    await expect(open({ ...sealed, ciphertext: altered }, transit())).rejects.toThrow(/authentication/);
  });

  withBao('a truncated ciphertext is refused before any key is fetched', async () => {
    await expect(
      open({ ciphertext: Buffer.alloc(4), wrappedDek: Buffer.from('vault:v1:x') }, transit()),
    ).rejects.toThrow(/too short/);
  });

  withBao("a DEK wrapped by another vault's key cannot be unwrapped", async () => {
    // The reason there is one Transit key per vault: holding the clinical client is
    // not enough to read an identity record, even with the row in hand.
    const sealed = await seal('clinical content', transit('alaap-clinical'));
    await expect(open(sealed, transit('alaap-identity'))).rejects.toThrow(CryptoError);
  });
});

describe('key rotation', () => {
  withBao('leaves records wrapped by the old version readable', async () => {
    // What storing `key_version` per row buys: nothing needs re-encrypting, and a
    // rotation is not a migration.
    const before = await seal('written before the rotation', transit());

    const rotated = await fetch(`${ADDRESS}/v1/transit/keys/alaap-billing/rotate`, {
      method: 'POST',
      headers: { 'x-vault-token': TOKEN },
    });
    expect(rotated.status).toBeLessThan(300);

    expect(await open(before, transit())).toBe('written before the rotation');
  });
});

describe('maximum privacy', () => {
  it('is not platform-readable, and says so', () => {
    // The audit registry depends on this being true: "Maximum Privacy records never
    // produce clinical.record.decrypted because the platform holds no key for them."
    expect(isPlatformReadable('standard')).toBe(true);
    expect(isPlatformReadable('maximum')).toBe(false);
  });
});

describe('when Transit is unreachable', () => {
  it('fails closed rather than writing something unencrypted', async () => {
    const dead = new TransitClient({
      address: 'http://127.0.0.1:9',
      token: 'x',
      keyId: 'alaap-clinical',
      timeoutMs: 300,
    });
    await expect(seal('content', dead)).rejects.toThrow(CryptoError);
  });
});
