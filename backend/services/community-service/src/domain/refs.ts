/**
 * Public references. `P-883920` for a post, `R-114872` for a reply.
 *
 * WHY NOT THE PRIMARY KEY
 *
 * The row id is a uuid and stays internal. What the interface shows, what a member
 * quotes when they report something, and what a moderator types into a queue is this
 * separate value — so that nothing a person can see is the key the database joins on.
 *
 * WHY RANDOM AND NOT SEQUENTIAL
 *
 * A sequential ref discloses how much the platform is used and when an account joined,
 * and lets anyone walk the corpus by counting. `P-000001` through `P-000400` is a
 * complete archive of a mental health community's first week. Random digits cost
 * nothing and remove the question.
 *
 * Collisions are handled by the UNIQUE constraint and a retry, not by checking first —
 * a check-then-insert race produces exactly the duplicate the constraint exists to
 * prevent. At 6 digits the space is 900,000 per prefix, which is small; the retry loop
 * is what makes that safe rather than the space being large.
 */

import { randomInt } from 'node:crypto';

export type RefKind = 'post' | 'reply';

const PREFIX: Record<RefKind, string> = { post: 'P', reply: 'R' };

/** Matches what generateRef produces, and nothing else. */
export const REF_PATTERN = /^[PR]-\d{6}$/;

export function generateRef(kind: RefKind): string {
  // 100000..999999 so the ref is always six digits and never shows a leading zero
  // that a member might drop when typing it into a report.
  return `${PREFIX[kind]}-${randomInt(100_000, 1_000_000)}`;
}

export function isWellFormedRef(value: string): boolean {
  return REF_PATTERN.test(value);
}

export function refKind(value: string): RefKind | undefined {
  if (!isWellFormedRef(value)) return undefined;
  return value.startsWith('P-') ? 'post' : 'reply';
}
