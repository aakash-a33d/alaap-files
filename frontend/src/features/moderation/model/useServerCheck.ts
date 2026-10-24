import { useEffect, useRef, useState } from 'react'
import {
  ModerationUnavailable,
  moderate,
  type ServerSurface,
  type ServerVerdict,
} from '../api/client'

/* ============================================================================
   The debounced server check.

   Typing is not a reason to send a request. This waits for a pause, cancels
   whatever was in flight, and drops any answer that arrives for text the
   member has already moved past — an answer to an older draft is worse than no
   answer, because it disables a button for words that are no longer there.
   ========================================================================= */

export type CheckState =
  /** nothing worth asking about yet */
  | 'idle'
  /** a request is out */
  | 'checking'
  /** the server answered for the current text */
  | 'ready'
  /** the server could not be reached; the device check is all there is */
  | 'offline'

export type ServerCheck = {
  state: CheckState
  verdict: ServerVerdict | null
}

/** Long enough that a sentence is not four requests, short enough that a pause
    before pressing send is already answered. */
const PAUSE_MS = 450

/** Below this there is nothing meaningful to judge, and asking anyway means the
    member is told their first three words are fine, which is noise. */
const MIN_CHARS = 12

/**
 * `enabled` is false on a member's own post, where there is no question to ask:
 * no category is in scope for a post, so the answer would be `allowed` every
 * time and the request is pure noise. It is a parameter rather than a caller-side
 * `if` because hooks cannot be called conditionally, and moving the branch into
 * the caller would mean two composers instead of one.
 */
export function useServerCheck(
  text: string,
  surface: ServerSurface,
  enabled = true,
): ServerCheck {
  const [check, setCheck] = useState<ServerCheck>({ state: 'idle', verdict: null })
  const controller = useRef<AbortController | null>(null)

  useEffect(() => {
    controller.current?.abort()

    if (!enabled || text.trim().length < MIN_CHARS) {
      setCheck({ state: 'idle', verdict: null })
      return
    }

    /* The previous verdict is kept on screen while the next one is fetched.
       Clearing it would make the enforcement state flicker open on every pause
       — briefly enabling a send button that is about to be disabled again. */
    setCheck((prev) => ({ state: 'checking', verdict: prev.verdict }))

    const timer = setTimeout(() => {
      const ac = new AbortController()
      controller.current = ac

      moderate(text, surface, ac.signal)
        .then((verdict) => setCheck({ state: 'ready', verdict }))
        .catch((err: unknown) => {
          if ((err as Error)?.name === 'AbortError') return
          if (err instanceof ModerationUnavailable) {
            setCheck({ state: 'offline', verdict: null })
            return
          }
          setCheck({ state: 'offline', verdict: null })
        })
    }, PAUSE_MS)

    return () => {
      clearTimeout(timer)
      controller.current?.abort()
    }
  }, [text, surface, enabled])

  return check
}
