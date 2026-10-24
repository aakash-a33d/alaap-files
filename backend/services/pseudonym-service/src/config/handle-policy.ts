/**
 * Load and check the handle vocabulary.
 *
 * The checks here are not schema validation — the JSON Schema already covers shapes
 * and ranges. These are the invariants a schema cannot express, and each one, if
 * violated, produces a failure that is silent in development and serious in
 * production. Better to refuse to start.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';

import {
  HANDLE_PATTERN,
  handleSpaceSize,
  normaliseHandle,
  type HandlePolicy,
} from '../domain/handle.ts';

/**
 * Handles are permanent, so the space is a ceiling on total accounts, not a collision
 * budget. The floor is roughly ten times the platform's membership target, so the
 * retry loop in personas.ts draws into a mostly empty space; a space merely LARGER
 * than the target still ends with signup retrying ten times and failing.
 */
const MINIMUM_HANDLE_SPACE = 100_000_000;

interface RawPolicy {
  adjectives: string[];
  nouns: string[];
  number_min: number;
  number_max: number;
  normalise: {
    case_fold: boolean;
    strip_separators: boolean;
    separators: string;
    confusables: Record<string, string>;
  };
}

export function loadHandlePolicy(root: string): HandlePolicy {
  const path = resolve(root, 'metadata/pseudonyms/handle-words.v1.yaml');
  const raw = parseYaml(readFileSync(path, 'utf8')) as RawPolicy;

  const confusables = new Map(Object.entries(raw.normalise.confusables));

  const policy: HandlePolicy = {
    adjectives: raw.adjectives,
    nouns: raw.nouns,
    numberMin: raw.number_min,
    numberMax: raw.number_max,
    normalise: {
      caseFold: raw.normalise.case_fold,
      stripSeparators: raw.normalise.strip_separators,
      separators: raw.normalise.separators,
      confusables,
    },
  };

  // 1. Every word must actually be a word.
  //
  // YAML turns a bare `null` into a null and a bare `no` into false, so a list that
  // reads correctly can arrive holding something that is not a string. Caught here
  // rather than at the first draw, which would produce a handle reading
  // `nullRiver-4821` and store it.
  for (const [label, list] of [
    ['adjective', policy.adjectives],
    ['noun', policy.nouns],
  ] as const) {
    for (const word of list) {
      if (typeof word !== 'string' || !/^[A-Z][a-z]{2,11}$/.test(word)) {
        throw new Error(
          `handle vocabulary: ${label} ${JSON.stringify(word)} is not a capitalised ` +
            `3-12 letter word — it would produce a handle that fails HANDLE_PATTERN`,
        );
      }
    }
  }

  // 2. No word may appear twice in its own list, or the draw is not uniform and the
  //    space is smaller than it claims.
  for (const [label, list] of [
    ['adjective', policy.adjectives],
    ['noun', policy.nouns],
  ] as const) {
    if (new Set(list).size !== list.length) {
      throw new Error(`handle vocabulary: the ${label} list repeats a word`);
    }
  }

  // 3. No word may appear in BOTH lists, which would permit `CrossingCrossing-4821`.
  //    Harmless mechanically, but it reads as a bug to whoever is looking at it.
  const shared = policy.adjectives.filter((w) => policy.nouns.includes(w));
  if (shared.length > 0) {
    throw new Error(`handle vocabulary: ${shared.join(', ')} appear in both lists`);
  }

  // 4. Normalisation must be idempotent, or the uniqueness key is not a key.
  //
  // It stops being idempotent the moment a confusable TARGET is also a SOURCE: fold
  // 1 -> l and l -> i and the same handle yields a different answer depending on how
  // many times it was folded. The unique index would then admit two rows that are the
  // same handle, and recovery could resolve to whichever was written first.
  for (const [source, target] of confusables) {
    if (confusables.has(target)) {
      throw new Error(
        `handle vocabulary: confusable ${source} -> ${target}, but ${target} is itself ` +
          `folded to ${confusables.get(target)!} — normalisation would not be idempotent`,
      );
    }
  }

  // 5. The generator must only ever produce handles the validator accepts.
  //
  // Cheap to prove by sampling, and it catches the combination the per-word check
  // above cannot see — a number range that has drifted outside \d{4,6}.
  for (let i = 0; i < 64; i += 1) {
    const adjective = policy.adjectives[i % policy.adjectives.length]!;
    const noun = policy.nouns[i % policy.nouns.length]!;
    for (const n of [policy.numberMin, policy.numberMax]) {
      const candidate = `${adjective}${noun}-${n}`;
      if (!HANDLE_PATTERN.test(candidate)) {
        throw new Error(
          `handle vocabulary: would generate ${candidate}, which is not a well-formed handle`,
        );
      }
      if (normaliseHandle(candidate, policy).length === 0) {
        throw new Error(`handle vocabulary: ${candidate} normalises to nothing`);
      }
    }
  }

  // 6. The space is a ceiling on accounts. See the constant above.
  const space = handleSpaceSize(policy);
  if (space < MINIMUM_HANDLE_SPACE) {
    throw new Error(
      `handle vocabulary: the space is only ${space} — handles are permanent, so this ` +
        `is a hard ceiling on total accounts (need ${MINIMUM_HANDLE_SPACE}). Add words.`,
    );
  }

  return policy;
}

export { MINIMUM_HANDLE_SPACE };
