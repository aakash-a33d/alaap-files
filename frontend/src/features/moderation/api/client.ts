/* ============================================================================
   The server moderation layer (§14.2).

   Two layers, and they are not the same thing:

   §14.1  the on-device check in ../model/preflight.ts. Runs on every keystroke,
          catches the plain cases, never blocks on a network call. Advice.

   §14.2  this. The decision — allowed, reword, held, blocked — and whether the
          rewrite is mandatory for the surface being written on. Authority.

   The composer shows the first while someone types and defers to the second
   before anything sends. When the second cannot be reached the composer says so
   rather than pretending the device check was the decision.

   THIS CALLS THE GATEWAY, NOT THE AI TIER.

   It used to call VITE_AI_URL — port 8000, the orchestrator, directly — as a
   development affordance. Architecture §8.1 is that the browser never reaches
   the AI tier: authentication, purpose limitation, consent, rate limiting,
   minimisation and the audit trail all live at the gateway, and a browser that
   can reach port 8000 bypasses all six. The audit vault, which exists to answer
   "who asked what, when", would have held no row for any of it.

   `/api/ai/check` is that route. It requires a session, declares
   `community-moderation` as its purpose, and audits every call.
   ========================================================================= */

import { api } from '../../../lib/api/client'
import { ApiError, NetworkError } from '../../../lib/api/errors'

/** Mirrors PublicVerdict in ai-services/shared/src/schemas/moderation.py. */
export type ServerVerdict = {
  decision:
    | 'allowed'
    | 'suggest_rewording'
    | 'limited_visibility'
    | 'blocked'
    | 'crisis_flag'
    | 'abuse_pattern'
  categories: string[]
  reason: string
  rewrite_guidance: string | null
  pii_kinds: string[]
  /** whether the rewrite blocks sending — the server decides this, not the client */
  rewrite_required: boolean
  appealable: boolean
  notice: string
}

export type ServerSurface = 'post' | 'comment' | 'message'

export class ModerationUnavailable extends Error {}

/**
 * Ask the server for a decision.
 *
 * `signal` matters in practice: the composer calls this as somebody types, and a
 * verdict for text that is three keystrokes old must not land after a newer one.
 *
 * An unreachable or erroring service raises ModerationUnavailable rather than
 * returning a verdict. There is no safe default here — guessing "allowed" would
 * publish an unchecked reply into somebody's difficult week, and guessing
 * "blocked" would tell a member their words were refused when nobody read them.
 */
export async function moderate(
  text: string,
  surface: ServerSurface,
  signal?: AbortSignal,
): Promise<ServerVerdict> {
  try {
    return await api.post<ServerVerdict>(
      '/api/ai/check',
      { text, surface },
      signal ? { signal } : {},
    )
  } catch (cause) {
    /* A cancelled keystroke is not a failure — let it through so the caller can
       ignore it rather than showing an offline state. */
    if ((cause as Error)?.name === 'AbortError') throw cause
    if (cause instanceof NetworkError) throw new ModerationUnavailable('safety service unreachable')
    if (cause instanceof ApiError) {
      // 401 is the session, not the safety service. It must reach the caller as
      // itself so the app can send them to sign in rather than telling them the
      // check failed.
      if (cause.isUnauthenticated) throw cause
      throw new ModerationUnavailable(`safety service returned ${cause.status}`)
    }
    throw cause
  }
}
