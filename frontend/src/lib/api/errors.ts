/* ============================================================================
   What the server says when it says no.

   The backend is careful to distinguish refusals that look alike from a
   distance, and the client's job is to not flatten them back together. Four
   different things are happening and they call for four different screens:

     402  this is on another plan
     429  you have used this month's allowance
     451  you asked us to stop, and we did
     503  we could not run the safety check

   The one that matters most is 451. clinical-vault-service checks consent
   BEFORE quota specifically so that a member who withdrew consent is never
   told they have run out of journal entries — being shown a paywall at the
   moment you assert control over your own data is the platform telling you
   that control costs money. Collapsing these into "something went wrong"
   throws away a decision that was made deliberately on the server.
   ========================================================================= */

/** The refusal codes the UI is expected to handle by name. */
export type RefusalCode =
  | 'not_entitled'
  | 'quota_exceeded'
  | 'consent_withdrawn'
  | 'moderation_unavailable'

export type QuotaDetail = {
  limit: number
  used: number
  /** ISO timestamp. The first of next month, in UTC. */
  resetsAt: string
}

export class ApiError extends Error {
  readonly status: number
  /** The server's machine-readable code, where it sent one. */
  readonly code: string
  /** Extra fields the server attached — quota numbers, a verdict id. */
  readonly detail: Record<string, unknown>

  constructor(status: number, code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
  }

  /** Not signed in, or the session died. The caller sends them to /signin. */
  get isUnauthenticated(): boolean {
    return this.status === 401
  }

  /** On another plan. NOT a rate that resets — never render this as "try later". */
  get isNotEntitled(): boolean {
    return this.status === 402 || this.code === 'not_entitled'
  }

  /** Out of allowance. Comes with numbers; show them rather than a bare refusal. */
  get isQuotaExceeded(): boolean {
    return this.status === 429 || this.code === 'quota_exceeded'
  }

  /**
   * They withdrew consent for this.
   *
   * The screen for this says two things, and the second is the important one:
   * the processing stopped, and nothing they wrote was deleted.
   */
  get isConsentWithdrawn(): boolean {
    return this.status === 451 || this.code === 'consent_withdrawn'
  }

  /**
   * The safety check could not run.
   *
   * Not the same as "your reply was rejected", and the composer must not say so.
   * Somebody who has just written something difficult and is told it was refused,
   * when in fact a service was down, has been given a verdict nobody reached.
   */
  get isModerationUnavailable(): boolean {
    return this.status === 503 || this.code === 'moderation_unavailable'
  }

  /** The quota numbers, when this is a quota refusal. */
  get quota(): QuotaDetail | undefined {
    const { limit, used, resetsAt } = this.detail
    if (typeof limit === 'number' && typeof used === 'number' && typeof resetsAt === 'string') {
      return { limit, used, resetsAt }
    }
    return undefined
  }
}

/**
 * The network did not reach the gateway at all.
 *
 * Kept distinct from an ApiError because the honest message differs: one is the
 * platform declining, the other is the platform being unreachable, and telling
 * somebody their post was refused when the wifi dropped is a lie.
 */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('could not reach the server')
    this.name = 'NetworkError'
    this.cause = cause
  }
}

/**
 * The platform could not be reached, as opposed to it answering "no".
 *
 * Either the network never got there, or something in front of the services
 * answered for them: the gateway or the dev proxy says 502, 503 or 504 when the
 * service behind it is down, with none of the service's own error codes. A
 * screen that turns this into "check what you typed" sends the member looking
 * for a mistake they did not make.
 */
export function isUnreachable(err: unknown): boolean {
  if (err instanceof NetworkError) return true
  return err instanceof ApiError && [502, 503, 504].includes(err.status) && err.code === 'unknown'
}
