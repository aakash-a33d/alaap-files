/* ============================================================================
   Taking your data, and being forgotten.

   Both routes sit behind `step_up: true` in the gateway's route policy, so a
   session alone is not enough — the member has to prove, within the last fifteen
   minutes, that it is them. A stolen session must not be able to exfiltrate an
   account's history or destroy it, and those are exactly the two things here.

   That means every call in this file can return 403 `step_up_required`, and the
   caller is expected to run the step-up first rather than treat it as an error.
   `stepUp()` below is the whole of that flow.
   ========================================================================= */

import { api } from '../../../lib/api/client'
import { ApiError } from '../../../lib/api/errors'

/** The scope the gateway checks against the route policy. Not a free string. */
export const DATA_RIGHTS_SCOPE = '/api/data-rights'

export type StepUpChallenge = {
  challengeId: string
  expiresInSeconds: number
  /** Development only. Absent in deployment, where the SMS carries it. */
  devCode?: string
}

/** Ask for a code, to the number already on the account. */
export async function stepUpStart(scope = DATA_RIGHTS_SCOPE): Promise<StepUpChallenge> {
  return api.post<StepUpChallenge>('/api/account/step-up/start', { scope })
}

/**
 * Submit the code.
 *
 * Answers `{ steppedUp: true }` and no token. The gateway reads that answer on its
 * way past and stamps the live session; nothing here holds a credential, which is
 * the point — a second factor that handed one back would be a second way in rather
 * than a check on the way already taken.
 */
export async function stepUpVerify(input: {
  challengeId: string
  code: string
  scope?: string
}): Promise<{ steppedUp: boolean; scope: string }> {
  return api.post<{ steppedUp: boolean; scope: string }>('/api/account/step-up/verify', {
    challengeId: input.challengeId,
    code: input.code,
    scope: input.scope ?? DATA_RIGHTS_SCOPE,
  })
}

/**
 * Everything the member wrote, as JSON.
 *
 * Assembled on demand and never stored, so asking for your data does not create a
 * second copy of it. Replies other people wrote are excluded — those are their
 * words — and the file says so in its own `notice` field, which the UI should show
 * rather than paraphrase.
 */
export async function exportAll(): Promise<Record<string, unknown>> {
  return api.get<Record<string, unknown>>('/api/data-rights/export')
}

export type DeletionReceipt = {
  deleted: boolean
  /** 'completed' | 'partial' | 'failed' */
  state: string
  receipt: { service: string; outcome: string; purged: number | null; detail: string | null }[]
  detail: string | null
  message: string
}

/**
 * Delete the account.
 *
 * Irreversible, immediate, and not deferred — the guard against an impulsive
 * deletion is the step-up the gateway already demanded, not a waiting room, because
 * a grace period would mean the platform kept data after being told to stop.
 *
 * Returns a receipt naming every vault and what happened in each. `state: 'partial'`
 * is a real answer: a record under legal hold survives, everything else is gone, and
 * the member is entitled to both halves of that.
 */
export async function deleteAccount(): Promise<DeletionReceipt> {
  return api.post<DeletionReceipt>('/api/data-rights/deletion')
}

/** True when a failure is the gateway asking for a second factor. */
export function needsStepUp(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403 && err.code === 'step_up_required'
}
