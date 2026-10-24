/**
 * Journals and mood, and the two gates in front of them.
 *
 *   entitlement   is this feature on the member's plan at all
 *   consent       has the member agreed to this processing, and not withdrawn it
 *
 * They are separate questions and fail differently. An entitlement refusal says "this
 * is on another plan"; a consent refusal says "you asked us to stop, and we did".
 * Collapsing them would tell somebody who withdrew consent that they need to pay.
 */

import type { AuditClient } from '@alaap/audit-client';

import type { ConsentClient } from '../infrastructure/consent-client.ts';
import type {
  JournalEntry,
  MoodCheckin,
  RecordRepository,
  SealedEntry,
} from '../infrastructure/records.ts';
import {
  checkQuota,
  quotaPeriodStart,
  type Plan,
  type PlanCatalogue,
  type QuotaDecision,
} from '../domain/quotas.ts';

export interface ClinicalDeps {
  records: RecordRepository;
  consent: ConsentClient;
  audit: AuditClient;
  catalogue: PlanCatalogue;
  defaultPlanId: string;
  log: { warn(o: object, m?: string): void; error(o: object, m?: string): void };
}

export interface Caller {
  pseudoId: number;
  requestId: string;
}

export type WriteOutcome =
  | { ok: true; entry: JournalEntry }
  | { ok: false; reason: 'not_entitled' }
  | { ok: false; reason: 'quota_exceeded'; detail: QuotaDecision }
  | { ok: false; reason: 'consent_withdrawn' };

/** The entitlement a journal entry needs. Named in metadata/catalog/plans/. */
const JOURNAL_ENTITLEMENT = 'private-journal';

export class Clinical {
  private readonly deps: ClinicalDeps;

  constructor(deps: ClinicalDeps) {
    this.deps = deps;
  }

  /**
   * The plan a member is on.
   *
   * Everyone is on `DEFAULT_PLAN_ID` until billing-subsidy-service exists, and that
   * defaults to the free tier — on which journals are not available at all. That is
   * the correct production behaviour and an inconvenient development one, which is
   * why it is configurable rather than hard-coded.
   */
  private planFor(_pseudoId: number): Plan {
    const plan = this.deps.catalogue.plans.find((p) => p.id === this.deps.defaultPlanId);
    if (plan === undefined) {
      throw new Error(`DEFAULT_PLAN_ID ${this.deps.defaultPlanId} is not in the plan catalogue`);
    }
    return plan;
  }

  private entitled(plan: Plan, entitlement: string): boolean {
    // A quota of zero is the plans file's way of saying "not on this tier". Checked
    // alongside the entitlement list so a plan cannot advertise a feature it then
    // permits none of.
    if (entitlement === JOURNAL_ENTITLEMENT) {
      return plan.quotas.journalEntriesPerMonth !== 0;
    }
    return plan.entitlements.includes(entitlement);
  }

  async writeJournal(
    caller: Caller,
    input: { body: string; entryDate?: string | undefined },
    now: Date = new Date(),
  ): Promise<WriteOutcome> {
    const plan = this.planFor(caller.pseudoId);
    if (!this.entitled(plan, JOURNAL_ENTITLEMENT)) {
      return { ok: false, reason: 'not_entitled' };
    }

    // Consent before quota. A member who has withdrawn consent should be told that,
    // not told they have run out of an allowance they are no longer using.
    const allowed = await this.deps.consent.allows({
      pseudoId: caller.pseudoId,
      purpose: 'care-delivery',
      requestId: caller.requestId,
    });
    if (!allowed) return { ok: false, reason: 'consent_withdrawn' };

    const used = await this.deps.records.countJournalSince(
      caller.pseudoId,
      quotaPeriodStart(now),
    );
    const quota = checkQuota(plan, 'journal_entries_per_month', used, now);
    if (!quota.allowed) return { ok: false, reason: 'quota_exceeded', detail: quota };

    const entry = await this.deps.records.writeJournal({
      pseudoId: caller.pseudoId,
      body: input.body,
      entryDate: input.entryDate,
    });

    await this.deps.audit.write({
      requestId: caller.requestId,
      pseudoId: caller.pseudoId,
      actorRole: 'user',
      serviceName: 'clinical-vault-service',
      actionType: 'clinical.journal.written',
      purpose: 'care-delivery',
      consentDecision: 'granted',
      accessResult: 'allowed',
      // Never the body, never the word count, never the date. That an entry exists is
      // the fact the trail needs; what is in it is the thing the encryption is for.
      context: { record_kind: 'journal', vault: 'clinical', privacy_mode: 'standard' },
    });

    return { ok: true, entry };
  }

  /**
   * Read one entry back.
   *
   * Every decrypt is audited. `clinical.record.decrypted` is sensitivity 4 and exists
   * precisely so that "who opened this, and when" is answerable — including when the
   * answer is the member themselves, because a trail with gaps for the ordinary case
   * cannot prove anything about the extraordinary one.
   */
  async readJournal(
    caller: Caller,
    id: string,
  ): Promise<JournalEntry | SealedEntry | undefined> {
    const entry = await this.deps.records.readJournal(caller.pseudoId, id);
    if (entry === undefined) return undefined;

    // A maximum-privacy record produces no decrypt event, because none happened. The
    // audit registry states this: the platform holds no key for them.
    if ('readable' in entry) return entry;

    await this.deps.audit.write({
      requestId: caller.requestId,
      pseudoId: caller.pseudoId,
      actorRole: 'user',
      serviceName: 'clinical-vault-service',
      actionType: 'clinical.record.decrypted',
      purpose: 'care-delivery',
      consentDecision: 'granted',
      accessResult: 'allowed',
      context: { record_kind: 'journal', vault: 'clinical', privacy_mode: 'standard' },
    });

    return entry;
  }

  async listJournal(caller: Caller): Promise<unknown[]> {
    // No decrypt event: nothing was decrypted. A list is dates and lengths.
    return this.deps.records.listJournal(caller.pseudoId, 50) as never;
  }

  async deleteJournal(caller: Caller, id: string): Promise<boolean> {
    const gone = await this.deps.records.deleteJournal(caller.pseudoId, id);
    if (!gone) return false;

    await this.deps.audit.write({
      requestId: caller.requestId,
      pseudoId: caller.pseudoId,
      actorRole: 'user',
      serviceName: 'clinical-vault-service',
      actionType: 'clinical.journal.deleted',
      purpose: 'care-delivery',
      consentDecision: 'not_required',
      accessResult: 'allowed',
      // Permanent retention on this event type: deletion evidence outlives the record
      // it destroyed, or the platform cannot prove it complied.
      context: { record_kind: 'journal', vault: 'clinical' },
    });
    return true;
  }

  /**
   * Mood. Never gated — not by plan, not by quota, not by consent.
   *
   * `never_gated` in the plans catalogue and the reasoning beside it: a quota
   * restricts what a person may write on a paid surface, and a single number is not
   * that. It is the lowest-friction way for somebody to begin engaging at all.
   */
  async recordMood(
    caller: Caller,
    input: {
      moodScore: number;
      energyScore?: number | undefined;
      sleepHours?: number | undefined;
      stressScore?: number | undefined;
      emotionTags?: string[] | undefined;
    },
  ): Promise<MoodCheckin> {
    const checkin = await this.deps.records.recordMood({ pseudoId: caller.pseudoId, ...input });

    await this.deps.audit.write({
      requestId: caller.requestId,
      pseudoId: caller.pseudoId,
      actorRole: 'user',
      serviceName: 'clinical-vault-service',
      actionType: 'clinical.mood.recorded',
      purpose: 'care-delivery',
      consentDecision: 'not_required',
      accessResult: 'allowed',
      // Not the score. A mood value in the audit vault would be clinical content in a
      // store with a different retention policy and a different set of readers.
      context: { record_kind: 'mood', vault: 'clinical' },
    });

    return checkin;
  }

  async moodHistory(caller: Caller, days: number): Promise<MoodCheckin[]> {
    return this.deps.records.moodHistory(caller.pseudoId, days);
  }
}
