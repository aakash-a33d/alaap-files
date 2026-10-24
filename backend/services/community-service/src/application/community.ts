/**
 * Posting, reading and replying.
 *
 * Two rules shape everything here, and both are easier to state than to keep:
 *
 *   A member's own post is never moderated and never gated.
 *   A reply is moderated, because somebody else is on the receiving end.
 *
 * The asymmetry is the product decision. A person may say anything about their own
 * life, however bleak, angry, bitter or unfair, and nothing stands between them and
 * saying it. What they may not do is aim it at someone.
 */

import type { AuditClient } from '@alaap/audit-client';

import type { AiClient, ModerationClient, Verdict } from '../infrastructure/ai-client.ts';
import type { Post, PostRepository, Reply } from '../infrastructure/posts.ts';
import {
  checkQuota,
  expiryFor,
  quotaPeriodStart,
  type Plan,
  type PlanCatalogue,
  type QuotaDecision,
} from '../domain/quotas.ts';
import { freePlan } from '../config/plans.ts';

export interface CommunityDeps {
  posts: PostRepository;
  ai: AiClient;
  moderation: ModerationClient;
  audit: AuditClient;
  catalogue: PlanCatalogue;
  log: { warn(o: object, m?: string): void; error(o: object, m?: string): void };
}

export interface Caller {
  pseudoId: number;
  requestId: string;
}

export type PostOutcome =
  | { ok: true; post: Post }
  | { ok: false; reason: 'quota_exceeded'; quota: QuotaDecision }
  | { ok: false; reason: 'unknown_category' };

export type ReplyOutcome =
  | { ok: true; reply: Reply }
  | { ok: false; reason: 'quota_exceeded'; quota: QuotaDecision }
  | { ok: false; reason: 'post_unavailable' }
  | { ok: false; reason: 'blocked'; message: string; verdictId: string | undefined }
  | { ok: false; reason: 'moderation_unavailable' };

export class Community {
  private readonly deps: CommunityDeps;

  constructor(deps: CommunityDeps) {
    this.deps = deps;
  }

  /**
   * The plan a member is on.
   *
   * Everyone is on the free plan until billing-subsidy-service exists. Stated as a
   * method with this comment rather than inlined, so that when that service lands
   * there is one place to change and it is obvious what it was standing in for.
   *
   * Defaulting to FREE and not to unlimited is the safe direction: the failure mode is
   * a paying member briefly held to free limits, which is visible and fixable, rather
   * than every member silently ungated.
   */
  private planFor(_pseudoId: number): Plan {
    return freePlan(this.deps.catalogue);
  }

  /**
   * What this member's plan lets them do.
   *
   * Exists because the interface cannot be honest without it. Word ceilings, which
   * kinds of writing are offered at all, and how many peer replies are visible are
   * all plan decisions — a client that does not know the plan either hardcodes one,
   * which is a lie, or discovers it by attempting things and reading 402s, which
   * means showing somebody a door before telling them it is locked.
   *
   * Nothing here is private. It is the pricing table plus which row applies, and
   * both halves are already public — quotas live in metadata/catalog/plans/.
   *
   * `neverGated` is included on purpose. It is the list of things no plan may
   * restrict, and shipping it to the client makes that promise checkable from
   * outside rather than only true inside this service.
   */
  entitlements(caller: Caller): {
    planId: string;
    name: string;
    tier: number;
    quotas: Plan['quotas'];
    entitlements: readonly string[];
    neverGated: string[];
  } {
    const plan = this.planFor(caller.pseudoId);
    return {
      planId: plan.id,
      name: plan.name,
      tier: plan.tier,
      quotas: plan.quotas,
      entitlements: plan.entitlements,
      neverGated: [...this.deps.catalogue.neverGated],
    };
  }

  /**
   * Write a post.
   *
   * Published as it is written. There is no moderation pass and no pending state —
   * see the note at the top of this file.
   */
  async createPost(
    caller: Caller,
    input: { categoryId: string; body: string; visibilityDays?: number | undefined },
    now: Date = new Date(),
  ): Promise<PostOutcome> {
    const categories = await this.deps.posts.categories();
    if (!categories.some((c) => c.id === input.categoryId)) {
      return { ok: false, reason: 'unknown_category' };
    }

    const plan = this.planFor(caller.pseudoId);
    const used = await this.deps.posts.countPostsSince(caller.pseudoId, quotaPeriodStart(now));
    const quota = checkQuota(plan, 'posts_per_month', used, now);
    if (!quota.allowed) return { ok: false, reason: 'quota_exceeded', quota };

    const post = await this.deps.posts.createPost({
      pseudoId: caller.pseudoId,
      categoryId: input.categoryId,
      body: input.body,
      expiresAt: expiryFor(plan, now, input.visibilityDays),
    });

    // No audit write here, deliberately.
    //
    // The gateway already records this request as `gateway.community.create` — the
    // /api/community group is audited at `writes`. A second row from this service
    // would describe the same event twice, and a trail that double-counts is a trail
    // nobody can reason about. The same mistake was made once before, when one request
    // wrote two rows and the second claimed a denial that had not happened.
    //
    // The reply path below DOES write, because the moderation verdict is a fact the
    // gateway cannot see.

    // Crisis triage, on the published text and never on a draft.
    //
    // Not awaited. It gates nothing, it changes nothing the member sees, and a post
    // must not wait on A2 to appear — "It does not block anything, and it does not
    // tell you what it found" is the consent text, and both halves are enforced by
    // this line rather than by intention.
    void this.deps.ai
      .triagePublishedPost({ ref: post.ref, body: input.body, requestId: caller.requestId })
      .catch((err: unknown) => {
        this.deps.log.warn(
          { err: err instanceof Error ? err.message : String(err), post: post.ref },
          'crisis triage failed for a published post',
        );
      });

    return { ok: true, post };
  }

  async feed(params: {
    limit: number;
    before?: string | undefined;
    categoryId?: string | undefined;
  }): Promise<Post[]> {
    return this.deps.posts.feed({
      limit: Math.min(Math.max(params.limit, 1), 50),
      before: params.before,
      categoryId: params.categoryId,
    });
  }

  async post(ref: string): Promise<{ post: Post; replies: Reply[] } | undefined> {
    const post = await this.deps.posts.findByRef(ref);
    if (post === undefined) return undefined;
    return { post, replies: await this.deps.posts.repliesFor(ref) };
  }

  async ownPosts(caller: Caller): Promise<Post[]> {
    return this.deps.posts.postsByAuthor(caller.pseudoId, 50);
  }

  /**
   * Write a reply. Moderated before it is published.
   *
   * Order matters and is not arbitrary:
   *
   *   1. quota   — cheapest, and refusing here costs no GPU time
   *   2. post exists and is live
   *   3. moderation
   *   4. write
   *
   * A blocked reply is still WRITTEN, with state 'blocked'. It is not published and
   * the author of the post never sees it, but an appeal needs the text it is appealing
   * about, and a repeat offender is only visible as a pattern if the attempts exist.
   */
  async createReply(
    caller: Caller,
    input: { postRef: string; body: string },
    now: Date = new Date(),
  ): Promise<ReplyOutcome> {
    const plan = this.planFor(caller.pseudoId);
    const used = await this.deps.posts.countRepliesSince(caller.pseudoId, quotaPeriodStart(now));
    const quota = checkQuota(plan, 'replies_written_per_month', used, now);
    if (!quota.allowed) return { ok: false, reason: 'quota_exceeded', quota };

    const post = await this.deps.posts.findByRef(input.postRef);
    if (post === undefined || post.state !== 'published') {
      return { ok: false, reason: 'post_unavailable' };
    }

    let verdict: Verdict;
    try {
      verdict = await this.deps.ai.moderateReply({
        body: input.body,
        context: post.body,
        requestId: caller.requestId,
      });
    } catch (cause) {
      // FAIL CLOSED. Unlike device bookkeeping at sign-in, this is not a degradable
      // feature: publishing unmoderated replies because the classifier is unreachable
      // puts the harm on the person the reply is aimed at. A member is asked to try
      // again; the alternative is somebody reading something nobody checked.
      this.deps.log.error(
        { requestId: caller.requestId, err: cause instanceof Error ? cause.message : cause },
        'moderation unavailable; refusing the reply',
      );
      return { ok: false, reason: 'moderation_unavailable' };
    }

    const published = verdict.decision === 'allowed';
    const reply = await this.deps.posts.createReply({
      postRef: input.postRef,
      pseudoId: caller.pseudoId,
      body: input.body,
      state: published ? 'published' : 'blocked',
    });
    // The post expired between the check above and the insert. Rare, and a real
    // occurrence on a five-day window while somebody is composing.
    if (reply === undefined) return { ok: false, reason: 'post_unavailable' };

    // Recorded by moderation-service, which owns the table. Never fails the request:
    // the reply is written and its state already reflects the decision, so a missing
    // verdict costs the member the ability to APPEAL rather than costing them the
    // reply. Logged loudly because that loss is real.
    const verdictId = await this.deps.moderation.recordCommentVerdict({
      commentRef: reply.ref,
      decision: published ? 'allowed' : 'blocked',
      categories: verdict.categories,
      modelId: verdict.safetyModelId,
      modelVersion: verdict.safetyModelId,
      latencyMs: verdict.latencyMs,
      requestId: caller.requestId,
    });
    if (verdictId === undefined) {
      this.deps.log.error(
        { requestId: caller.requestId, replyRef: reply.ref },
        'verdict not recorded; this reply cannot be appealed',
      );
    }

    await this.deps.audit.write({
      requestId: caller.requestId,
      pseudoId: caller.pseudoId,
      actorRole: 'user',
      serviceName: 'community-service',
      actionType: 'moderation.verdict.issued',
      purpose: 'community-moderation',
      consentDecision: 'not_required',
      accessResult: published ? 'allowed' : 'denied',
      // The categories that fired are operational fact and safe to keep. The reply
      // itself is not here, and neither is the post it answered.
      context: {
        record_kind: 'reply',
        status: published ? 200 : 422,
        model_version: verdict.safetyModelId,
        ...(verdict.categories.length > 0 ? { denial_reason: verdict.categories.join(',') } : {}),
      },
    });

    if (!published) {
      // The reason comes from the orchestrator's public projection, which is written
      // for a person rather than for a log. Never the scores, never the categories —
      // telling somebody exactly which classifier fired is a tuning oracle.
      return { ok: false, reason: 'blocked', message: verdict.reason, verdictId };
    }
    return { ok: true, reply };
  }
}
