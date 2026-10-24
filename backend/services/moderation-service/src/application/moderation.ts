/**
 * Reports, appeals, and the record of what was decided.
 *
 * moderation-service owns `moderation_verdicts`, and community-service has no write on
 * it — that split is in the grants, deliberately. It is why community-service asks
 * this service to record a decision rather than writing one itself, and it is what
 * makes an appeal possible at all: an appeal points at a verdict, so a verdict has to
 * exist somewhere a member can reach.
 */

import type { AuditClient } from '@alaap/audit-client';

import type { ModerationPolicy } from '../config/policy.ts';
import type { AppealReason } from '../config/policy.ts';
import type {
  Appeal,
  ModerationRepository,
  Report,
  Verdict,
} from '../infrastructure/moderation.ts';

export interface ModerationDeps {
  repo: ModerationRepository;
  policy: ModerationPolicy;
  audit: AuditClient;
  log: { warn(o: object, m?: string): void; error(o: object, m?: string): void };
}

export interface Caller {
  pseudoId: number;
  requestId: string;
}

export type RecordOutcome =
  | { ok: true; verdict: Verdict }
  | { ok: false; reason: 'unknown_subject' | 'unknown_category' };

export type ReportOutcome =
  | { ok: true; report: Report; alreadyReported: false }
  | { ok: true; alreadyReported: true }
  | { ok: false; reason: 'unknown_reason' | 'unknown_subject' };

export type AppealOutcome =
  | { ok: true; appeal: Appeal }
  | { ok: false; reason: 'unknown_verdict' | 'unknown_reason' | 'already_appealed' };

export class Moderation {
  private readonly deps: ModerationDeps;

  constructor(deps: ModerationDeps) {
    this.deps = deps;
  }

  /**
   * Record what was decided about a reply. Internal — community-service calls this.
   *
   * Recorded AFTER the reply row exists, because the verdict references it. That
   * ordering also means a verdict is never orphaned: if the reply insert failed, there
   * is nothing to record a decision about.
   */
  async recordCommentVerdict(params: {
    commentRef: string;
    decision: string;
    categories: string[];
    modelId: string;
    modelVersion: string;
    latencyMs: number;
    requestId: string;
  }): Promise<RecordOutcome> {
    const unknown = params.categories.filter((c) => !this.deps.policy.categoryIds.has(c));
    if (unknown.length > 0) {
      // The classifier named something the policy does not know. Refused rather than
      // stored: a verdict citing a category with no severity cannot be triaged, and
      // the mismatch means the two lists have drifted.
      this.deps.log.error(
        { requestId: params.requestId, unknown },
        'verdict names categories the policy does not know',
      );
      return { ok: false, reason: 'unknown_category' };
    }

    const policyVersion = await this.deps.repo.currentPolicyVersion();
    const verdict = await this.deps.repo.recordCommentVerdict({
      commentRef: params.commentRef,
      decision: params.decision,
      categories: params.categories,
      modelId: params.modelId,
      modelVersion: params.modelVersion,
      policyVersion,
      latencyMs: params.latencyMs,
    });
    if (verdict === undefined) return { ok: false, reason: 'unknown_subject' };
    return { ok: true, verdict };
  }

  /**
   * A member reports something.
   *
   * Reports are idempotent per reporter. A second report from the same person adds
   * nothing to a queue and dilutes the count a reviewer uses to judge how many
   * DIFFERENT people objected — which is the number that matters, because fifty
   * reports from one account and fifty from fifty accounts mean opposite things.
   *
   * The member is told the same thing either way. "You have already reported this"
   * reads as a rebuke to somebody who is worried they were not heard.
   */
  async report(
    caller: Caller,
    input: {
      subjectType: 'post' | 'comment';
      subjectRef: string;
      reasonCode: string;
      note?: string | undefined;
    },
  ): Promise<ReportOutcome> {
    const reason = this.deps.policy.reportReasons.find((r) => r.id === input.reasonCode);
    if (reason === undefined) return { ok: false, reason: 'unknown_reason' };

    if (await this.deps.repo.hasReported(caller.pseudoId, input.subjectType, input.subjectRef)) {
      return { ok: true, alreadyReported: true };
    }

    const report = await this.deps.repo.createReport({
      reporterPseudoId: caller.pseudoId,
      subjectType: input.subjectType,
      subjectRef: input.subjectRef,
      reasonCode: input.reasonCode,
      note: input.note,
    });
    if (report === undefined) return { ok: false, reason: 'unknown_subject' };

    await this.deps.audit.write({
      requestId: caller.requestId,
      pseudoId: caller.pseudoId,
      actorRole: 'user',
      serviceName: 'moderation-service',
      actionType: 'safety.signal.raised',
      purpose: 'community-moderation',
      consentDecision: 'not_required',
      accessResult: 'allowed',
      // The reason code and whether it is urgent. Never the note — a member writing
      // in their own words about what happened to them is content, not metadata.
      context: {
        record_kind: 'report',
        denial_reason: input.reasonCode,
        ...(reason.urgent ? { risk_band: 'urgent' } : {}),
      },
    });

    return { ok: true, report, alreadyReported: false };
  }

  /**
   * A member appeals a decision about something they wrote.
   *
   * One open appeal per verdict. A second would not be reviewed any sooner and would
   * put the same decision in a queue twice.
   */
  async appeal(
    caller: Caller,
    input: { verdictId: string; reasonCode: string; statement?: string | undefined },
  ): Promise<AppealOutcome> {
    if (!this.deps.policy.appealReasons.some((r) => r.id === input.reasonCode)) {
      return { ok: false, reason: 'unknown_reason' };
    }

    // Scoped to the appellant inside the query. An unknown verdict and somebody
    // else's verdict are the same answer, because distinguishing them would confirm
    // that a particular reply existed and was blocked.
    const verdict = await this.deps.repo.verdictForAuthor(input.verdictId, caller.pseudoId);
    if (verdict === undefined) return { ok: false, reason: 'unknown_verdict' };

    if ((await this.deps.repo.openAppealFor(input.verdictId)) !== undefined) {
      return { ok: false, reason: 'already_appealed' };
    }

    const statement =
      input.statement === undefined
        ? `[${input.reasonCode}]`
        : `[${input.reasonCode}] ${input.statement}`;
    const appeal = await this.deps.repo.createAppeal({
      verdictId: input.verdictId,
      appellantPseudoId: caller.pseudoId,
      statement,
    });

    await this.deps.audit.write({
      requestId: caller.requestId,
      pseudoId: caller.pseudoId,
      actorRole: 'user',
      serviceName: 'moderation-service',
      actionType: 'moderation.appeal.decided',
      purpose: 'community-moderation',
      consentDecision: 'not_required',
      accessResult: 'allowed',
      // Filed, not decided. The event type covers the appeal's lifecycle and this is
      // its opening; `status` distinguishes this row from the resolution that follows.
      context: { record_kind: 'appeal', status: 201, denial_reason: input.reasonCode },
    });

    return { ok: true, appeal };
  }

  async myAppeals(caller: Caller): Promise<Appeal[]> {
    return this.deps.repo.appealsFor(caller.pseudoId);
  }

  /** The reasons an interface offers. Metadata, so the words are reviewable. */
  reasons(): {
    report: { id: string; label: string; blurb: string }[];
    appeal: readonly AppealReason[];
  } {
    return {
      report: this.deps.policy.reportReasons.map((r) => ({
        id: r.id,
        label: r.label,
        blurb: r.blurb,
      })),
      appeal: this.deps.policy.appealReasons,
    };
  }
}
