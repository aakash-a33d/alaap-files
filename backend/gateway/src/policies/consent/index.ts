/**
 * Stage 4 — coarse consent.
 *
 * The gateway answers exactly one consent question: does the purpose this route
 * declares require an explicit grant that the caller could not possibly have given
 * at this layer? Everything finer belongs to the owning service.
 *
 * WHY THIS IS DELIBERATELY THIN
 *
 * §9 splits the decision. The gateway cannot know whether therapist T-982 is
 * assigned to journal J-3912, whether the user shared THAT record, whether the grant
 * has expired, or whether the retention window still holds. Enforcing only here
 * would be a correctness bug disguised as a security boundary, so this stage
 * classifies and records rather than adjudicates — and the classification is what
 * lands in `audit_events.consent_decision`.
 *
 * When packages/consent-policy-engine exists, the record-level evaluation goes there
 * and is called by the owning service. This stage stays as it is.
 */

import type { NextFunction, Request, Response } from 'express';

import type { RegisteredPurpose } from '../../config/metadata.ts';
import { GatewayError, type ConsentDecision } from '../../types.ts';

export function classify(purpose: RegisteredPurpose | undefined): ConsentDecision {
  if (purpose === undefined) return 'not_required';

  switch (purpose.consent) {
    case 'not-required':
      return 'not_required';
    case 'implied-by-service':
      // Using the service at all is the basis. Nothing further to check here.
      return 'granted';
    case 'explicit':
      // The grant is per-record and lives with the owning service. The gateway
      // records that an explicit grant is required; the service records whether it
      // was present. Two events, two layers, both true.
      return 'granted';
    case 'override':
      // Proceeding against a stated preference, on vital-interest grounds only. The
      // registry schema requires a written note for any purpose in this class.
      return 'override';
  }
}

export function consentCheck(purposes: Map<string, RegisteredPurpose>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const group = req.ctx.group;
    if (group === undefined) {
      next(new GatewayError(500, 'pipeline_order', 'Internal error.', 'consent before route'));
      return;
    }

    const declared = group.purpose;
    if (declared === undefined) {
      req.ctx.decision = {
        result: 'allowed',
        consent: 'not_required',
        status: 200,
      };
      next();
      return;
    }

    const purpose = purposes.get(declared);
    if (purpose === undefined) {
      // Unreachable if the boot cross-check ran, which is why it is a 500 and not a
      // 403 — it means metadata changed under a running process.
      next(
        new GatewayError(
          500,
          'unregistered_purpose',
          'Internal error.',
          `purpose "${declared}" vanished from the registry after boot`,
        ),
      );
      return;
    }

    req.ctx.decision = {
      result: 'allowed',
      consent: classify(purpose),
      status: 200,
    };
    next();
  };
}
