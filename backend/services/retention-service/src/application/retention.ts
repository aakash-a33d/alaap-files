/**
 * Export and deletion, orchestrated across services that each hold one vault.
 *
 * The rule this file exists to keep: retention-service decides WHEN and reports WHAT
 * HAPPENED; the owning service decides HOW. It never opens a vault, because it cannot —
 * the database refuses it CONNECT on every vault but its own bookkeeping tables.
 */

import type { AuditClient } from '@alaap/audit-client';

import { EXPORT_ORDER, PURGE_ORDER } from '../config/targets.ts';
import type { PurgeClient } from '../infrastructure/purge-client.ts';
import type { RequestRepository } from '../infrastructure/requests.ts';

export interface RetentionDeps {
  repo: RequestRepository;
  purge: PurgeClient;
  audit: AuditClient;
  /** Base URL per service id, from the environment. Absent means not deployed. */
  upstreams: Map<string, string>;
  log: { info(o: object, m?: string): void; warn(o: object, m?: string): void; error(o: object, m?: string): void };
}

export interface Caller {
  pseudoId: number;
  requestId: string;
}

export class Retention {
  private readonly deps: RetentionDeps;

  constructor(deps: RetentionDeps) {
    this.deps = deps;
  }

  /**
   * Everything the member wrote, assembled from the services that hold it.
   *
   * A vault that cannot be reached fails the whole export rather than returning a
   * partial one. Half a person's history, handed over as though it were all of it, is
   * worse than an error — they would have no way to know what was missing.
   */
  async exportAll(caller: Caller): Promise<Record<string, unknown>> {
    await this.deps.audit.write({
      requestId: caller.requestId,
      pseudoId: caller.pseudoId,
      actorRole: 'user',
      serviceName: 'retention-service',
      actionType: 'data_rights.export.requested',
      purpose: 'data-export',
      consentDecision: 'granted',
      accessResult: 'allowed',
      context: { record_kind: 'export' },
    });

    const out: Record<string, unknown> = {
      exportedAt: new Date().toISOString(),
      notice:
        'Everything under "replies" and "posts" was written by you. Replies other ' +
        'people wrote to you are not included — those are their words, not yours to ' +
        'take. Anything under "aiResponses" was written by Alaap to you, and is here ' +
        'because it is part of your record rather than because you wrote it. The audit ' +
        'trail is not included: it records who accessed what, names staff and services, ' +
        'and is what proves we honoured this request.',
    };

    for (const target of EXPORT_ORDER) {
      const base = this.deps.upstreams.get(target.service);
      if (base === undefined) {
        throw new Error(`no upstream configured for ${target.service}`);
      }
      out[target.service] = await this.deps.purge.exportFrom(base, caller.pseudoId, caller.requestId);
    }

    const bytes = Buffer.byteLength(JSON.stringify(out), 'utf8');
    await this.deps.repo.recordExport(caller.pseudoId, bytes);

    // Sensitivity 5. An entire account's contents leaving the platform is the single
    // largest disclosure it performs, and it should be the loudest row in the vault —
    // even, and especially, when the person asking owns every word of it.
    await this.deps.audit.write({
      requestId: caller.requestId,
      pseudoId: caller.pseudoId,
      actorRole: 'user',
      serviceName: 'retention-service',
      actionType: 'data_rights.export.delivered',
      purpose: 'data-export',
      consentDecision: 'granted',
      accessResult: 'allowed',
      context: { record_kind: 'export', record_count: bytes },
    });

    return out;
  }

  /**
   * Delete the account, vault by vault, in the order that keeps the member
   * identifiable until the last possible moment.
   *
   * Runs to completion rather than stopping at the first problem. A vault that refuses
   * — a legal hold, an unreachable service — is recorded and the run continues, because
   * one held post must not leave the member's journal in place.
   */
  async deleteAccount(caller: Caller): Promise<{
    state: string;
    detail: string | null;
    receipt: { service: string; outcome: string; purged: number | null; detail: string | null }[];
  }> {
    await this.deps.audit.write({
      requestId: caller.requestId,
      pseudoId: caller.pseudoId,
      actorRole: 'user',
      serviceName: 'retention-service',
      actionType: 'data_rights.deletion.requested',
      purpose: 'data-deletion',
      consentDecision: 'granted',
      accessResult: 'allowed',
      context: { record_kind: 'deletion' },
    });

    const request = await this.deps.repo.open(caller.pseudoId);

    /**
     * Whether any vault has retained something.
     *
     * This decides the fate of the handle, and the reason is not obvious until you
     * watch it go wrong: `community_posts.author_pseudo_id` references
     * `pseudo_profiles` with ON DELETE CASCADE, so purging the persona destroys every
     * post the member wrote — including one community-service has just refused to
     * delete because it is under legal hold, and has told the member survives.
     *
     * The deeper rule the cascade was enforcing by accident: an identity cannot be
     * erased while a record attributable to it is being retained. A post kept for an
     * appeal with no author to attribute it to is not evidence of anything, and the
     * appeal it was kept for cannot be heard.
     *
     * So the handle is held too, and the member is told why. It is the one piece of
     * their identity that outlives the deletion, it exists only for as long as the
     * held record does, and saying so is better than a silent cascade either way.
     */
    let somethingHeld = false;

    // Bounded by the number of targets. A job that keeps failing is marked failed
    // rather than retried here — a deletion that loops is one nobody can report on.
    for (let handled = 0; handled < PURGE_ORDER.length + 1; handled += 1) {
      const job = await this.deps.repo.claimNext(request.id);
      if (job === undefined) break;

      if (job.targetService === 'pseudonym-service' && somethingHeld) {
        await this.deps.repo.finish(job, 'held', {
          purged: 0,
          detail:
            'Your handle has been kept for now, because a record of yours is being ' +
            'retained and would otherwise be destroyed with it. It will be removed when ' +
            'that record is, and it identifies nothing else.',
        });
        this.deps.log.info({ service: job.targetService }, 'handle held behind a retained record');
        continue;
      }

      const base = this.deps.upstreams.get(job.targetService);
      if (base === undefined) {
        await this.deps.repo.finish(job, 'failed', {
          detail: `${job.targetService} is not deployed, so its records could not be deleted.`,
        });
        continue;
      }

      try {
        const result = await this.deps.purge.purge(base, job.pseudoId, caller.requestId);
        if (result.held > 0) somethingHeld = true;
        await this.deps.repo.finish(job, result.held > 0 ? 'held' : 'purged', {
          purged: result.purged,
          ...(result.detail.length > 0 ? { detail: result.detail.join(' ') } : {}),
        });
        this.deps.log.info(
          { service: job.targetService, purged: result.purged, held: result.held },
          'vault purged',
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.deps.log.error({ service: job.targetService, err: message }, 'purge failed');
        await this.deps.repo.finish(job, 'failed', {
          detail: `${job.targetService} could not be cleared: ${message}`,
        });
      }
    }

    const closed = await this.deps.repo.close(request.id);
    const receipt = await this.deps.repo.receipt(request.id);

    // Permanent retention, and the reason it is permanent: the evidence that a deletion
    // happened must outlive everything it deleted, or the platform cannot prove it
    // complied — and the member is left holding only our word.
    //
    // Written AFTER the purge, deliberately. auth-service has by now deleted the
    // account this row is attributed to, and that is correct: the pseudo id remains in
    // the audit vault pointing at nobody, which is precisely what makes keeping the
    // trail survivable for the person who asked to be forgotten.
    await this.deps.audit.write({
      requestId: caller.requestId,
      pseudoId: caller.pseudoId,
      actorRole: 'user',
      serviceName: 'retention-service',
      actionType: 'data_rights.deletion.completed',
      purpose: 'data-deletion',
      consentDecision: 'granted',
      accessResult: 'allowed',
      context: {
        record_kind: 'deletion',
        record_count: receipt.reduce((n, r) => n + (r.purged ?? 0), 0),
        retention_reason: closed.state,
      },
    });

    return { state: closed.state, detail: closed.detail, receipt };
  }
}
