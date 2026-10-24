/**
 * Granting and withdrawing consent.
 *
 * The asymmetry between the two is the whole design. Granting needs a version to point
 * at, and refuses without one — consent to nothing in particular is not consent.
 * Withdrawing needs nothing and refuses for no reason: a member who cannot stop has
 * not consented, they have been enrolled.
 */

import type { AuditClient } from '@alaap/audit-client';

import type { ConsentRecord, ConsentRepository } from '../infrastructure/consent.ts';

export interface ConsentDeps {
  repo: ConsentRepository;
  /** Purposes the platform has declared. From metadata/consent/purpose-registry/. */
  purposes: ReadonlySet<string>;
  audit: AuditClient;
  log: { warn(o: object, m?: string): void; error(o: object, m?: string): void };
}

export interface Caller {
  pseudoId: number;
  requestId: string;
}

export type GrantOutcome =
  | { ok: true; record: ConsentRecord }
  | { ok: false; reason: 'unknown_purpose' | 'no_published_version' };

export class Consent {
  private readonly deps: ConsentDeps;

  constructor(deps: ConsentDeps) {
    this.deps = deps;
  }

  async isGranted(pseudoId: number, purpose: string): Promise<boolean> {
    // An unregistered purpose is never granted, whatever the table says. A purpose
    // that was removed from the registry is one the platform has stopped claiming it
    // processes for, and a stale row must not keep it alive.
    if (!this.deps.purposes.has(purpose)) return false;
    return this.deps.repo.isGranted(pseudoId, purpose);
  }

  async grant(caller: Caller, purpose: string): Promise<GrantOutcome> {
    if (!this.deps.purposes.has(purpose)) return { ok: false, reason: 'unknown_purpose' };

    const versionId = await this.deps.repo.currentVersion(purpose);
    if (versionId === undefined) {
      // No published text for this purpose. Refused rather than recorded against
      // nothing: a consent record that points at no version cannot answer "what did
      // they agree to", which is the only question it exists to answer.
      this.deps.log.warn({ purpose }, 'consent requested for a purpose with no published version');
      return { ok: false, reason: 'no_published_version' };
    }

    const record = await this.deps.repo.grant({
      pseudoId: caller.pseudoId,
      purpose,
      versionId,
    });

    await this.deps.audit.write({
      requestId: caller.requestId,
      pseudoId: caller.pseudoId,
      actorRole: 'user',
      serviceName: 'consent-service',
      actionType: 'consent.granted',
      purpose,
      consentDecision: 'granted',
      accessResult: 'allowed',
      // The version is the point: consent to version 2 is not consent to version 5,
      // and an audit row that omitted it could not tell the two apart.
      context: { record_kind: 'consent', consent_version: versionId },
    });

    return { ok: true, record };
  }

  /**
   * Withdraw.
   *
   * Returns nothing a caller can refuse on. The route answers identically whether a
   * grant existed, and the audit row is written either way — a withdrawal attempt is
   * itself a fact worth keeping, and its absence from the trail would make "they never
   * asked" and "we lost it" the same shape.
   */
  async withdraw(caller: Caller, purpose: string): Promise<void> {
    const had = await this.deps.repo.withdraw({ pseudoId: caller.pseudoId, purpose });

    await this.deps.audit.write({
      requestId: caller.requestId,
      pseudoId: caller.pseudoId,
      actorRole: 'user',
      serviceName: 'consent-service',
      actionType: 'consent.withdrawn',
      purpose,
      consentDecision: 'withdrawn',
      accessResult: 'allowed',
      // Retained permanently. Proving a withdrawal was honoured requires knowing
      // exactly when it was made, indefinitely.
      context: { record_kind: 'consent', consent_state: had ? 'withdrawn' : 'nothing_granted' },
    });
  }

  async history(caller: Caller): Promise<ConsentRecord[]> {
    return this.deps.repo.history(caller.pseudoId);
  }
}
