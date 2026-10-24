/**
 * Handle generation and the vocabulary behind it.
 *
 * Loaded from the real metadata file rather than a fixture, because that file IS the
 * policy — a test against an inline fixture would keep passing after somebody emptied
 * the word lists or added one that reads as a diagnosis.
 */

import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadHandlePolicy, MINIMUM_HANDLE_SPACE } from '../src/config/handle-policy.ts';
import {
  avatarSeedFor,
  generateHandle,
  handleSpaceSize,
  isWellFormedHandle,
  normaliseHandle,
} from '../src/domain/handle.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const policy = loadHandlePolicy(ROOT);

describe('the vocabulary file itself', () => {
  // loadHandlePolicy throws on a broken invariant, so reaching this line is most of
  // the assertion. These restate the ones that would be quiet rather than loud.
  it('loads, which means every startup invariant holds', () => {
    expect(policy.adjectives.length).toBeGreaterThan(0);
    expect(policy.nouns.length).toBeGreaterThan(0);
  });

  it('is large enough to be a ceiling above the membership target', () => {
    // Handles are permanent and never returned to the pool, so this is a limit on
    // how many accounts can ever exist. The 30 x 30 vocabulary this replaced gave
    // 8.1 million — below the platform's own one-crore target.
    expect(handleSpaceSize(policy)).toBeGreaterThanOrEqual(MINIMUM_HANDLE_SPACE);
  });

  it('shares no word between the two lists', () => {
    // Otherwise `CrossingCrossing-4821` is reachable.
    const shared = policy.adjectives.filter((w) => policy.nouns.includes(w));
    expect(shared).toEqual([]);
  });

  it('contains no word that reads as a mood, a diagnosis or a verdict', () => {
    // A handle sits beside a post written by somebody having the worst week of their
    // life. It is not allowed to editorialise about them.
    const forbidden = [
      'sad', 'happy', 'depressed', 'anxious', 'manic', 'broken', 'lonely', 'angry',
      'bipolar', 'crazy', 'insane', 'psycho', 'toxic', 'weak', 'strong', 'failed',
      'hopeless', 'worthless', 'useless', 'lost', 'numb', 'empty', 'hurt', 'scared',
    ];
    const offenders = [...policy.adjectives, ...policy.nouns].filter((w) =>
      forbidden.includes(w.toLowerCase()),
    );
    expect(offenders).toEqual([]);
  });

  it('contains nothing that evokes blood or injury', () => {
    // The same line the safety classifier draws, applied to the platform's own copy.
    const forbidden = [
      'crimson', 'scarlet', 'blood', 'bloody', 'garnet', 'wound', 'scar', 'blade',
      'knife', 'razor', 'rope', 'noose', 'vein', 'bruise',
    ];
    const offenders = [...policy.adjectives, ...policy.nouns].filter((w) =>
      forbidden.includes(w.toLowerCase()),
    );
    expect(offenders).toEqual([]);
  });

  it('contains nothing about bodies, weight or appearance', () => {
    const forbidden = [
      'thin', 'slim', 'fat', 'skinny', 'heavy', 'ugly', 'pretty', 'beautiful',
      'bony', 'plump', 'slender', 'curvy',
    ];
    const offenders = [...policy.adjectives, ...policy.nouns].filter((w) =>
      forbidden.includes(w.toLowerCase()),
    );
    expect(offenders).toEqual([]);
  });
});

describe('generated handles', () => {
  it('are well-formed, every time', () => {
    for (let i = 0; i < 500; i += 1) {
      const h = generateHandle(policy);
      expect(isWellFormedHandle(h), h).toBe(true);
    }
  });

  it('look like the examples the platform promises', () => {
    // `QuietRiver-4821`, `PaperLantern-1174`, `SlowTide-2093`.
    for (let i = 0; i < 100; i += 1) {
      expect(generateHandle(policy), 'shape').toMatch(/^[A-Z][a-z]+[A-Z][a-z]+-\d{4}$/);
    }
  });

  it('draw the number from the declared range', () => {
    for (let i = 0; i < 300; i += 1) {
      const n = Number(generateHandle(policy).split('-')[1]);
      expect(n).toBeGreaterThanOrEqual(policy.numberMin);
      expect(n).toBeLessThanOrEqual(policy.numberMax);
    }
  });

  it('vary — 500 draws are nearly all distinct', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateHandle(policy)));
    expect(seen.size).toBeGreaterThan(495);
  });
});

describe('normalisation — what account recovery matches on', () => {
  it('folds case', () => {
    expect(normaliseHandle('SlowTide-2093', policy)).toBe(normaliseHandle('slowtide-2093', policy));
  });

  it('makes the hyphen optional', () => {
    expect(normaliseHandle('SlowTide-2093', policy)).toBe(normaliseHandle('SlowTide2093', policy));
  });

  it('rescues the transcription mistakes people actually make', () => {
    // Somebody copying a handle off paper, having lost their phone, writes O for 0
    // and l for 1. Getting them back in matters more than being strict.
    expect(normaliseHandle('SlowTide-2O93', policy)).toBe(normaliseHandle('SlowTide-2093', policy));
    expect(normaliseHandle('PaperLantern-ll74', policy)).toBe(
      normaliseHandle('PaperLantern-1174', policy),
    );
  });

  it('keeps distinct handles distinct', () => {
    expect(normaliseHandle('QuietRiver-4821', policy)).not.toBe(
      normaliseHandle('QuietRiver-4822', policy),
    );
    expect(normaliseHandle('QuietRiver-4821', policy)).not.toBe(
      normaliseHandle('SlowTide-4821', policy),
    );
  });

  it('is idempotent, or the unique index is not a key', () => {
    for (const h of ['SlowTide-2093', 'PaperLantern-1174', 'QuietRiver-4821', 'MistyNeem-1000']) {
      const once = normaliseHandle(h, policy);
      expect(normaliseHandle(once, policy), h).toBe(once);
    }
  });

  it('does not fold two drawn handles together, across a large sample', () => {
    // The property that lets the unique index sit on the normalised column without
    // rejecting legitimate signups. A collision is not a correctness bug — the
    // generator retries — but a frequent one would quietly shrink the space.
    const drawn = Array.from({ length: 5000 }, () => generateHandle(policy));
    const distinct = new Set(drawn);
    const normalised = new Set([...distinct].map((h) => normaliseHandle(h, policy)));
    expect(normalised.size).toBe(distinct.size);
  });
});

describe('well-formedness', () => {
  it('accepts the six-digit handles issued during an earlier widening', () => {
    // The platform's own earlier accounts must not be called malformed by a validator
    // written after them.
    expect(isWellFormedHandle('CoastalRooftop-631131')).toBe(true);
  });

  it('rejects anything a member might try to supply instead', () => {
    for (const bad of ['rahul', 'admin', 'QuietRiver', 'QuietRiver-42', 'quietriver-4821', '']) {
      expect(isWellFormedHandle(bad), bad).toBe(false);
    }
  });
});

describe('avatar seed', () => {
  it('changes when the handle changes', () => {
    // Seeded from the handle, not the pseudo_id, so nothing rendered in a feed is
    // computed from the cross-vault join key.
    expect(avatarSeedFor('QuietRiver-4821')).not.toBe(avatarSeedFor('SlowTide-2093'));
  });

  it('is stable for the same handle', () => {
    expect(avatarSeedFor('QuietRiver-4821')).toBe(avatarSeedFor('QuietRiver-4821'));
  });
});
