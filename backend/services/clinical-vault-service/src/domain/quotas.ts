/**
 * Plan quotas. Pure.
 *
 * WHAT A QUOTA IS ALLOWED TO DO
 *
 * Cap what a person may WRITE. Never what they may read, and never anything on the
 * safety path. That line is the whole design, and it is stated in the plans metadata
 * rather than here so it cannot be quietly moved by someone editing this file:
 *
 *   "A quota that is exhausted restricts what a person may WRITE. It never restricts
 *    what they may read, and never touches the safety path."
 *
 * An earlier design limited how many replies an author could SEE on their own post.
 * It was removed deliberately — it saved nothing, because the reply had already been
 * composed, scored, stored and reviewed by the time the interface decided whether to
 * show it, and it put an upgrade prompt in front of someone in acute distress.
 * `never_gated` in the metadata exists so it cannot come back by accident, and
 * `assertNeverGated` below is the running code that enforces the same thing.
 *
 * The columns that supported it - `hidden_from_author`, `reply_ordinal` and the
 * `post_visibility_rules` table - were dropped in
 * community-vault/0005_drop_reply_visibility.sql. A schema with somewhere to put a
 * hidden reply is an invitation to write one.
 */

export interface PlanQuotas {
  /** null means unlimited. Absent would be ambiguous; null is the declared value. */
  postsPerMonth: number | null;
  repliesWrittenPerMonth: number | null;
  aiResponsesPerPost: number;
  postVisibilityDays: number;
  postVisibilityExtendableToDays: number | null;
  /** 0 means the feature is not on this tier at all, which is not the same as a cap. */
  journalEntriesPerMonth: number | null;
  shortStoriesPerMonth: number | null;
}

export interface Plan {
  id: string;
  name: string;
  tier: number;
  quotas: PlanQuotas;
  entitlements: readonly string[];
}

export interface PlanCatalogue {
  plans: readonly Plan[];
  neverGated: ReadonlySet<string>;
  postExpiryDefaultDays: number;
}

export type QuotaKind =
  | 'posts_per_month'
  | 'replies_written_per_month'
  | 'journal_entries_per_month'
  | 'short_stories_per_month';

export type QuotaDecision =
  | { allowed: true; remaining: number | null }
  | { allowed: false; limit: number; used: number; resetsAt: string };

/**
 * The start of the quota month, in UTC.
 *
 * Calendar months, not rolling 30-day windows. A rolling window means a member cannot
 * answer "when do I get another post?" without the platform telling them, and the
 * answer changes every day. "The first of the month" is a thing a person can hold in
 * their head, which matters more here than the marginal fairness of a rolling window.
 */
export function quotaPeriodStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function quotaPeriodEnd(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export function planById(catalogue: PlanCatalogue, id: string): Plan | undefined {
  return catalogue.plans.find((p) => p.id === id);
}

/**
 * May this member write one more of these?
 *
 * `used` is counted by the caller from the vault, not tracked in a counter. A counter
 * drifts from the rows it claims to describe — a deleted post that still counts, or a
 * failed insert that does not — and the drift is invisible until someone is wrongly
 * refused. Counting the rows is slower and always right.
 */
export function checkQuota(
  plan: Plan,
  kind: QuotaKind,
  used: number,
  now: Date,
): QuotaDecision {
  const limit = {
    posts_per_month: plan.quotas.postsPerMonth,
    replies_written_per_month: plan.quotas.repliesWrittenPerMonth,
    journal_entries_per_month: plan.quotas.journalEntriesPerMonth,
    short_stories_per_month: plan.quotas.shortStoriesPerMonth,
  }[kind];

  if (limit === null) return { allowed: true, remaining: null };
  if (used < limit) return { allowed: true, remaining: limit - used };

  return {
    allowed: false,
    limit,
    used,
    resetsAt: quotaPeriodEnd(now).toISOString(),
  };
}

/**
 * Refuse to gate something the catalogue says is never gated.
 *
 * Called at the point a feature is about to be withheld. It throws rather than
 * returning false, because reaching it at all means a code path exists that would gate
 * reading or the safety path — and that is a bug to fix, not a condition to handle.
 */
export class NeverGatedError extends Error {
  readonly entitlement: string;

  constructor(entitlement: string) {
    super(
      `${entitlement} is in never_gated and must not be withheld for any plan, ` +
        `quota or payment reason. See metadata/catalog/plans/plans.v1.yaml.`,
    );
    this.name = 'NeverGatedError';
    this.entitlement = entitlement;
  }
}

export function assertNeverGated(catalogue: PlanCatalogue, entitlement: string): void {
  if (catalogue.neverGated.has(entitlement)) throw new NeverGatedError(entitlement);
}

/**
 * When a post published now should stop being visible.
 *
 * Five days by default, on every plan. Expiry is not a paid feature being withheld —
 * it is the default state of a post on this platform, and paid plans buy the ability
 * to EXTEND it. A person writing at 3am should not have to think about who can read
 * it next month.
 */
export function expiryFor(plan: Plan, publishedAt: Date, requestedDays?: number): Date {
  const base = plan.quotas.postVisibilityDays;
  const ceiling = plan.quotas.postVisibilityExtendableToDays ?? base;
  const days = Math.min(Math.max(requestedDays ?? base, base), ceiling);
  return new Date(publishedAt.getTime() + days * 86_400_000);
}

/** Whether this plan may extend expiry at all, for an interface that should not offer it. */
export function canExtendExpiry(plan: Plan): boolean {
  const ceiling = plan.quotas.postVisibilityExtendableToDays;
  return ceiling !== null && ceiling > plan.quotas.postVisibilityDays;
}
