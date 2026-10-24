/**
 * Public handles. Pure — no database, no clock, no randomness beyond node:crypto.
 *
 * `QuietRiver-4821` (§3.2). Every handle on the platform is drawn from the vocabulary
 * in metadata/pseudonyms/handle-words.v1.yaml. There is no path by which a member
 * supplies one, and that absence is the privacy property: a name somebody picks is
 * almost always a name they already use elsewhere, and reusing it here would tie
 * everything they write about their mental health to a public identity. A drawn
 * handle cannot carry that link, because nobody chose it.
 *
 * The vocabulary is metadata rather than constants here because it is user-facing
 * copy that appears beside difficult posts and needs review by people who do not
 * edit TypeScript.
 */

import { randomInt } from 'node:crypto';

export interface HandlePolicy {
  adjectives: readonly string[];
  nouns: readonly string[];
  numberMin: number;
  numberMax: number;
  normalise: {
    caseFold: boolean;
    stripSeparators: boolean;
    separators: string;
    confusables: ReadonlyMap<string, string>;
  };
}

/**
 * How many distinct handles exist.
 *
 * Handles are permanent and never returned to the pool, so this is a hard ceiling on
 * how many accounts can ever exist — not a collision budget. See the header of
 * handle-words.v1.yaml, and the floor enforced in config/handle-policy.ts.
 */
export function handleSpaceSize(policy: HandlePolicy): number {
  return (
    policy.adjectives.length * policy.nouns.length * (policy.numberMax - policy.numberMin + 1)
  );
}

/**
 * Draw a handle.
 *
 * randomInt, not Math.random: this is the name that identifies an account for its
 * whole life, and a predictable sequence would let somebody enumerate the accounts
 * created around the time of their own.
 */
export function generateHandle(policy: HandlePolicy): string {
  const adjective = policy.adjectives[randomInt(0, policy.adjectives.length)]!;
  const noun = policy.nouns[randomInt(0, policy.nouns.length)]!;
  const number = randomInt(policy.numberMin, policy.numberMax + 1);
  return `${adjective}${noun}-${number}`;
}

/**
 * The uniqueness key, and what account recovery matches on.
 *
 * Exists for one practical reason: somebody typing their handle to get back into
 * their account has usually copied it off a piece of paper, under stress, having lost
 * the phone. So case is folded, the hyphen is optional, and the characters people
 * actually mistype are folded together — O for 0, l for 1.
 *
 * `SlowTide-2093`, `slowtide2093` and `SlowTide-2O93` all reach the same account.
 *
 * No impersonation concern applies: every handle is drawn by the platform, so there
 * is no way to register `Rahu1` beside `Rahul`. Folding is purely a transcription aid.
 *
 * Idempotent: normalise(normalise(x)) === normalise(x), because no confusable target
 * is also a confusable source. config/handle-policy.ts refuses to start otherwise.
 */
export function normaliseHandle(raw: string, policy: HandlePolicy): string {
  let s = policy.normalise.caseFold ? raw.toLowerCase() : raw;
  if (policy.normalise.stripSeparators) {
    for (const sep of policy.normalise.separators) s = s.split(sep).join('');
  }
  let out = '';
  for (const ch of s) out += policy.normalise.confusables.get(ch) ?? ch;
  return out;
}

/**
 * Anything the interface renders as a handle must match this.
 *
 * Two words of 3-12 letters each, then 4 to 6 digits. The digit range is wider than
 * what the generator draws (4) because handles issued during an earlier widening of
 * the vocabulary carry 6, and the platform's own earliest accounts must not be called
 * malformed by a validator written after them.
 */
export const HANDLE_PATTERN = /^[A-Z][a-z]{2,11}[A-Z][a-z]{2,11}-\d{4,6}$/;

export function isWellFormedHandle(handle: string): boolean {
  return HANDLE_PATTERN.test(handle);
}

/**
 * Avatar seed.
 *
 * Derived from the handle rather than the pseudo_id, so nothing rendered in a feed is
 * computed from the cross-vault join key. Deriving anything visible from that value
 * invites somebody to try inverting it.
 */
export function avatarSeedFor(handle: string): string {
  let hash = 2166136261;
  for (let i = 0; i < handle.length; i += 1) {
    hash ^= handle.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
