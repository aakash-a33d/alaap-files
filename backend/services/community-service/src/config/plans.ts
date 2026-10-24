/**
 * Load the plan catalogue.
 *
 * The quotas a member is held to are metadata, not constants in a service. The checks
 * below are the invariants a JSON Schema cannot express — each one, if violated, is a
 * failure that is silent in development and unfair to a member in production.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';

import type { Plan, PlanCatalogue } from '../domain/quotas.ts';

interface RawPlan {
  id: string;
  name: string;
  tier: number;
  quotas: {
    posts_per_month: number | null;
    replies_written_per_month: number | null;
    ai_responses_per_post: number;
    post_visibility_days: number;
    post_visibility_extendable_to_days: number | null;
  };
  entitlements?: string[];
}

interface RawCatalogue {
  never_gated: string[];
  plans: RawPlan[];
  post_expiry: { default_days: number };
}

export function loadPlans(root: string): PlanCatalogue {
  const path = resolve(root, 'metadata/catalog/plans/plans.v1.yaml');
  const raw = parseYaml(readFileSync(path, 'utf8')) as RawCatalogue;

  const plans: Plan[] = raw.plans.map((p) => ({
    id: p.id,
    name: p.name,
    tier: p.tier,
    entitlements: p.entitlements ?? [],
    quotas: {
      postsPerMonth: p.quotas.posts_per_month,
      repliesWrittenPerMonth: p.quotas.replies_written_per_month,
      aiResponsesPerPost: p.quotas.ai_responses_per_post,
      postVisibilityDays: p.quotas.post_visibility_days,
      postVisibilityExtendableToDays: p.quotas.post_visibility_extendable_to_days,
    },
  }));

  if (plans.length === 0) throw new Error('plan catalogue: no plans');

  // 1. Exactly one free tier, and it must be tier 0.
  //
  // Everything unauthenticated-adjacent falls back to the free plan, so if there were
  // two, which one applied would depend on file order.
  const free = plans.filter((p) => p.tier === 0);
  if (free.length !== 1) {
    throw new Error(`plan catalogue: expected exactly one tier-0 plan, found ${free.length}`);
  }

  // 2. Tiers must be unique, or "is this plan above that one" has no answer.
  const tiers = new Set(plans.map((p) => p.tier));
  if (tiers.size !== plans.length) throw new Error('plan catalogue: two plans share a tier');

  for (const plan of plans) {
    const q = plan.quotas;

    // 3. A quota of 0 for writing is not a plan, it is a suspension.
    //
    // Zero is legitimate for journal and short stories - those are paid creation
    // features and the free plan genuinely has none. It is NOT legitimate for posts or
    // replies: a plan on which a person cannot say anything is not a tier of this
    // product, and would most likely be a typo for null.
    for (const [name, value] of [
      ['posts_per_month', q.postsPerMonth],
      ['replies_written_per_month', q.repliesWrittenPerMonth],
    ] as const) {
      if (value !== null && value <= 0) {
        throw new Error(
          `plan catalogue: ${plan.id} has ${name}=${value}. Use null for unlimited; ` +
            `zero would mean a member on this plan cannot speak at all.`,
        );
      }
    }

    // 4. Expiry must be extendable UPWARDS or not at all.
    if (
      q.postVisibilityExtendableToDays !== null &&
      q.postVisibilityExtendableToDays < q.postVisibilityDays
    ) {
      throw new Error(
        `plan catalogue: ${plan.id} extends visibility to ` +
          `${q.postVisibilityExtendableToDays} days, below its own default of ` +
          `${q.postVisibilityDays}. That would shorten a post's life, not lengthen it.`,
      );
    }

    // 5. Every plan gets the AI response. It is the thing that makes a post not be
    //    shouted into an empty room, and no tier of this product omits it.
    if (q.aiResponsesPerPost < 1) {
      throw new Error(`plan catalogue: ${plan.id} gets no AI response`);
    }
  }

  // 6. Quotas must not decrease as tier increases.
  //
  // A higher tier that buys fewer posts is a pricing table nobody meant to write, and
  // it would be discovered by a paying member rather than by a test.
  const ordered = [...plans].sort((a, b) => a.tier - b.tier);
  for (let i = 1; i < ordered.length; i += 1) {
    const lower = ordered[i - 1]!;
    const higher = ordered[i]!;
    for (const [name, get] of [
      ['posts_per_month', (p: Plan) => p.quotas.postsPerMonth],
      ['replies_written_per_month', (p: Plan) => p.quotas.repliesWrittenPerMonth],
    ] as const) {
      const lo = get(lower);
      const hi = get(higher);
      // null is unlimited, so it can never be a decrease.
      if (lo !== null && hi !== null && hi < lo) {
        throw new Error(
          `plan catalogue: ${higher.id} (tier ${higher.tier}) allows ${hi} ${name} ` +
            `but ${lower.id} (tier ${lower.tier}) allows ${lo}. Paying for less.`,
        );
      }
    }
  }

  const neverGated = new Set(raw.never_gated ?? []);
  if (!neverGated.has('replies-to-your-own-post')) {
    throw new Error(
      'plan catalogue: `replies-to-your-own-post` is missing from never_gated. It is ' +
        'there to stop reply-visibility gating being reintroduced by accident, which ' +
        'is exactly what its absence would allow.',
    );
  }

  return {
    plans,
    neverGated,
    postExpiryDefaultDays: raw.post_expiry?.default_days ?? 5,
  };
}

/** The plan a member is on when nothing says otherwise. */
export function freePlan(catalogue: PlanCatalogue): Plan {
  return catalogue.plans.find((p) => p.tier === 0)!;
}
