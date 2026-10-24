/**
 * Load the post categories.
 *
 * The ids live in `community_categories` because posts have a foreign key to them.
 * The words live in metadata/community/categories.v1.yaml, because the words are the
 * decision: these are SITUATIONS, not conditions.
 *
 *   just-today, study-and-exams, family, money, loss, something-good
 *   NOT depression, anxiety, OCD, trauma
 *
 * A list of conditions asks a person to diagnose themselves before they are allowed
 * to speak, and most of the people this platform is for have not been diagnosed and
 * should not have to guess. That reasoning is worth nothing if the client ships its
 * own list, which is exactly what it was doing — offering "Anxiety" and "Trauma
 * recovery" to a server that would refuse both as unknown categories.
 *
 * So the labels are served from here. One list, one set of words, and a picker that
 * cannot drift from what the server will accept.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';

export interface Category {
  id: string;
  label: string;
  blurb: string;
}

interface RawCategories {
  categories: { id: string; label: string; blurb: string }[];
}

export function loadCategories(root: string): Category[] {
  const path = resolve(root, 'metadata/community/categories.v1.yaml');
  const raw = parseYaml(readFileSync(path, 'utf8')) as RawCategories;

  if (!Array.isArray(raw.categories) || raw.categories.length === 0) {
    throw new Error(`${path} declares no categories`);
  }

  for (const c of raw.categories) {
    if (!c.id || !c.label) throw new Error(`${path}: category ${c.id ?? '?'} has no label`);
  }

  return raw.categories.map((c) => ({ id: c.id, label: c.label, blurb: c.blurb ?? '' }));
}
