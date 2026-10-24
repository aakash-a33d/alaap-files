/**
 * Stamping a step-up assertion onto a live session.
 *
 * The gateway checks `steppedUpAt` and `steppedUpScope` before letting anybody near
 * `/api/data-rights`, `/api/admin` or `/api/break-glass`. Until this file existed nothing
 * ever wrote them, so all three groups answered 403 to everyone — a control that was
 * enforced and unsatisfiable, the same shape as the session cookie the gateway read and
 * nobody issued.
 *
 * WHY THE GATEWAY WRITES IT
 *
 * auth-service verifies the code; it is the only thing that can. But the session record
 * lives in Redis under the gateway's hand, and the proxy strips `authorization` and
 * `cookie` before forwarding — so auth-service cannot know which session is in front of
 * it, let alone amend it. The verification and the amendment are therefore in different
 * places, joined here: auth-service answers "this member proved it is them", and the
 * gateway decides what that is worth and for how long.
 *
 * THE SCOPE IS CHECKED, NOT TRUSTED
 *
 * A step-up for "export my data" must never unlock break-glass. The scope is compared
 * against the route policy — it has to name a group that actually requires step-up — so
 * a granted assertion can only ever open a door that was already asking for one.
 */

import type { Request } from 'express';

import type { SessionStore } from '../infrastructure/session-store.ts';
import type { ApiGroup } from '../types.ts';

/** Shape auth-service answers with when a second factor checked out. */
interface StepUpAnswer {
  steppedUp?: unknown;
  scope?: unknown;
}

/**
 * Act on a verified step-up, if that is what this response is.
 *
 * Called only for groups declaring `step_up_grant: true`, and only for a request that
 * already resolved to a live session — an assertion has nothing to attach to otherwise.
 *
 * Returns the scope granted, or undefined. The caller logs it; there is deliberately no
 * audit write here, because the group that grants step-up writes its own.
 */
export async function applyStepUp(
  req: Request,
  sessions: SessionStore,
  groups: readonly ApiGroup[],
  status: number,
  body: Buffer,
): Promise<string | undefined> {
  if (status < 200 || status >= 300) return undefined;

  const token = req.ctx.sessionToken;
  if (token === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;

  const answer = parsed as StepUpAnswer;
  if (answer.steppedUp !== true) return undefined;
  if (typeof answer.scope !== 'string' || answer.scope === '') return undefined;

  // The scope must name a group that asks for step-up. Anything else is either a
  // mistake or an attempt to mint an assertion for a door nobody is guarding, and
  // both should fail rather than be stored and puzzled over later.
  const target = groups.find((g) => g.prefix === answer.scope && g.stepUp);
  if (target === undefined) {
    // Verified, but for a door nobody is guarding. Nothing is stamped — and it is
    // logged, because silently discarding a successful verification is the kind of
    // thing that gets diagnosed as "step-up is broken" weeks later.
    req.log?.warn({ scope: answer.scope }, 'step-up verified for a scope that requires none');
    return undefined;
  }

  await sessions.grantStepUp(token, target.prefix);
  return target.prefix;
}
