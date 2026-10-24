/**
 * Deleting an account across five services that each hold one vault.
 *
 * The live suite proves a deletion empties the databases. These cover what it cannot
 * arrange on demand: a vault that refuses, a vault that is not deployed, and the order
 * the purges must run in — which matters, and would break silently.
 */

import { describe, expect, it, vi } from 'vitest';

import { Retention } from '../src/application/retention.ts';
import { PURGE_ORDER } from '../src/config/targets.ts';

const CALLER = { pseudoId: 7, requestId: '11111111-1111-4111-8111-111111111111' };

/** Records every purge in the order it was asked for. */
function harness(
  behaviour: Record<string, { purged?: number; held?: number; detail?: string[]; throws?: string }> = {},
  opts: { missing?: string[] } = {},
) {
  const calls: string[] = [];
  const finished: { service: string; outcome: string }[] = [];
  const audits: string[] = [];
  let jobIndex = 0;

  const jobs = PURGE_ORDER.map((t, i) => ({
    id: `job-${i}`,
    requestId: 'req-1',
    pseudoId: CALLER.pseudoId,
    targetService: t.service,
    state: 'pending',
    attempts: 0,
  }));

  const repo = {
    async open() {
      return { id: 'req-1', pseudoId: CALLER.pseudoId, state: 'in_progress', requestedAt: '', completedAt: null, detail: null };
    },
    async claimNext() {
      return jobIndex < jobs.length ? jobs[jobIndex++] : undefined;
    },
    async finish(job: { targetService: string }, outcome: string) {
      finished.push({ service: job.targetService, outcome });
    },
    async close() {
      const failed = finished.some((f) => f.outcome === 'failed');
      const held = finished.some((f) => f.outcome === 'held');
      return {
        id: 'req-1',
        pseudoId: CALLER.pseudoId,
        state: failed ? 'failed' : held ? 'partial' : 'completed',
        requestedAt: '',
        completedAt: '',
        detail: null,
      };
    },
    async receipt() {
      return finished.map((f) => ({ service: f.service, outcome: f.outcome, purged: 0, detail: null }));
    },
    async recordExport() {},
  };

  const purge = {
    async purge(_base: string, _pseudoId: number, _requestId: string) {
      // The base URL identifies the target, since the harness maps one per service.
      const service = _base.replace('http://', '');
      calls.push(service);
      const b = behaviour[service];
      if (b?.throws !== undefined) throw new Error(b.throws);
      return { purged: b?.purged ?? 1, held: b?.held ?? 0, detail: b?.detail ?? [] };
    },
    async exportFrom(_base: string) {
      calls.push(`export:${_base.replace('http://', '')}`);
      return { some: 'data' };
    },
  };

  const upstreams = new Map<string, string>();
  for (const t of PURGE_ORDER) {
    if (opts.missing?.includes(t.service)) continue;
    upstreams.set(t.service, `http://${t.service}`);
  }

  const retention = new Retention({
    repo: repo as never,
    purge: purge as never,
    audit: {
      async write(row: { actionType: string }) {
        audits.push(row.actionType);
      },
    } as never,
    upstreams,
    log: { info() {}, warn() {}, error() {} },
  });

  return { retention, calls, finished, audits };
}

describe('the order vaults are emptied in', () => {
  it('leaves the handle until last', async () => {
    // The persona row is the only thing that makes a pseudo id resolvable to anything.
    // Deleting it first would leave every other purge working against an identifier
    // nothing could explain — and a run that then failed would strand the member with
    // orphaned content and no handle to find it by.
    const { retention, calls } = harness();
    await retention.deleteAccount(CALLER);

    expect(calls.at(-1)).toBe('pseudonym-service');
  });

  it('empties the content vaults before the account', async () => {
    const { retention, calls } = harness();
    await retention.deleteAccount(CALLER);

    expect(calls.indexOf('community-service')).toBeLessThan(calls.indexOf('auth-service'));
    expect(calls.indexOf('clinical-vault-service')).toBeLessThan(calls.indexOf('auth-service'));
  });

  it('asks every declared vault exactly once', async () => {
    const { retention, calls } = harness();
    await retention.deleteAccount(CALLER);

    expect(calls).toHaveLength(PURGE_ORDER.length);
    expect(new Set(calls).size).toBe(PURGE_ORDER.length);
  });
});

describe('when a vault refuses', () => {
  it('records a legal hold as held, not as failure', async () => {
    const { retention, finished } = harness({
      'community-service': { purged: 3, held: 1, detail: ['1 post is held for a moderation appeal.'] },
    });
    const outcome = await retention.deleteAccount(CALLER);

    expect(finished.find((f) => f.service === 'community-service')?.outcome).toBe('held');
    expect(outcome.state).toBe('partial');
  });

  it('keeps going, so one held post does not save the journal', async () => {
    // The failure mode this prevents: a member with one post under appeal has their
    // whole deletion abandoned, and their journal sits there indefinitely.
    //
    // The handle is the one exception and is covered below — it is held WITH the post,
    // because destroying it would cascade the post away.
    const { retention, calls, finished } = harness({
      'community-service': { held: 1, detail: ['held'] },
    });
    await retention.deleteAccount(CALLER);

    expect(calls).toContain('clinical-vault-service');
    expect(calls).toContain('consent-service');
    expect(calls).toContain('auth-service');
    expect(finished.filter((f) => f.outcome === 'purged')).toHaveLength(3);
  });

  it('holds the handle too, so a cascade cannot destroy what was held', async () => {
    // Found by the acceptance suite, not by reasoning. community_posts.author_pseudo_id
    // references pseudo_profiles ON DELETE CASCADE, so purging the persona silently
    // destroyed the very post community-service had just refused to delete and told the
    // member survives. The rule underneath: an identity cannot be erased while a record
    // attributable to it is being retained.
    const { retention, finished, calls } = harness({
      'community-service': { held: 1, detail: ['1 post is held for a moderation appeal.'] },
    });
    await retention.deleteAccount(CALLER);

    expect(finished.find((f) => f.service === 'pseudonym-service')?.outcome).toBe('held');
    // And it is held without asking the service, so nothing can cascade.
    expect(calls).not.toContain('pseudonym-service');
  });

  it('still purges the handle when nothing was held', async () => {
    const { retention, finished, calls } = harness();
    await retention.deleteAccount(CALLER);

    expect(finished.find((f) => f.service === 'pseudonym-service')?.outcome).toBe('purged');
    expect(calls).toContain('pseudonym-service');
  });

  it('keeps going when a vault throws outright', async () => {
    const { retention, calls, finished } = harness({
      'clinical-vault-service': { throws: 'connection refused' },
    });
    const outcome = await retention.deleteAccount(CALLER);

    expect(finished.find((f) => f.service === 'clinical-vault-service')?.outcome).toBe('failed');
    expect(calls).toContain('pseudonym-service');
    expect(outcome.state).toBe('failed');
  });

  it('reports an undeployed service as a failure rather than skipping it', async () => {
    // The worst available outcome is a deletion that quietly omits a vault and tells
    // the member it is done. A missing upstream is a failed job, and the request fails.
    const { retention, finished } = harness({}, { missing: ['clinical-vault-service'] });
    const outcome = await retention.deleteAccount(CALLER);

    expect(finished.find((f) => f.service === 'clinical-vault-service')?.outcome).toBe('failed');
    expect(outcome.state).toBe('failed');
  });
});

describe('the audit trail', () => {
  it('records the request and the completion, both permanent', async () => {
    const { retention, audits } = harness();
    await retention.deleteAccount(CALLER);

    expect(audits).toEqual([
      'data_rights.deletion.requested',
      'data_rights.deletion.completed',
    ]);
  });

  it('records completion even when the deletion was only partial', async () => {
    // Especially then. A partial deletion is the case somebody will later need to
    // reconstruct, and it is the one a service might be tempted not to log.
    const { retention, audits } = harness({ 'community-service': { held: 1 } });
    await retention.deleteAccount(CALLER);

    expect(audits).toContain('data_rights.deletion.completed');
  });
});

describe('export', () => {
  it('refuses to hand over a partial history', async () => {
    // Half a person's data, given to them as though it were all of it, is worse than
    // an error: they have no way to know what is missing.
    const { retention } = harness({}, { missing: ['clinical-vault-service'] });

    await expect(retention.exportAll(CALLER)).rejects.toThrow(/no upstream configured/);
  });

  it('says in the file itself what was left out and why', async () => {
    const { retention } = harness();
    const out = await retention.exportAll(CALLER);

    expect(String(out.notice)).toContain('their words');
    expect(String(out.notice)).toContain('audit trail is not');
  });

  it('is audited twice — asked for, and delivered', async () => {
    const { retention, audits } = harness();
    await retention.exportAll(CALLER);

    expect(audits).toEqual(['data_rights.export.requested', 'data_rights.export.delivered']);
  });
});
