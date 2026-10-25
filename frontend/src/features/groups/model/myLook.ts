import { useSyncExternalStore } from 'react'
import { api } from '../../../lib/api/client'
import { DEFAULT_LOOK, readLook, type AvatarLook } from './avatar'

/* ============================================================================
   The member's own look — the one portrait on the page that is theirs.

   It lives on the persona in pseudonym-service, beside the handle, and is
   read from the same `/api/pseudonym/me` every other part of the app asks
   "who am I" of. Nothing about it is kept in the browser: a look saved on a
   phone has to be the one the laptop shows in the next session.

   Held once for the page rather than per component, because the circle, the
   chat column, the presence card and the builder all draw it, and four
   fetches that could answer differently mid-save would show four people.
   ========================================================================= */

let look: AvatarLook = DEFAULT_LOOK
let requested = false
const listeners = new Set<() => void>()

function publish(next: AvatarLook) {
  look = next
  for (const l of listeners) l()
}

function load() {
  if (requested) return
  requested = true
  api
    .get<{ persona: { avatarLook?: unknown } }>('/api/pseudonym/me')
    .then(({ persona }) => {
      const saved = readLook(persona.avatarLook)
      if (saved) publish(saved)
    })
    .catch(() => {
      /* Signed out, or the service is down: the default is a complete,
         ordinary look, so the room still draws. Allow a later retry. */
      requested = false
    })
}

function subscribe(l: () => void) {
  listeners.add(l)
  load()
  return () => listeners.delete(l)
}

/** The member's saved look, or the default until it has loaded. */
export function useMyLook(): AvatarLook {
  return useSyncExternalStore(subscribe, () => look)
}

/** Save a look and show it everywhere at once. Throws if the server refused
    it, leaving the previous look in place — a look that only appears saved
    would be gone on the next reload, which is the one thing this must not do. */
export async function saveMyLook(next: AvatarLook): Promise<void> {
  const { avatarLook } = await api.post<{ avatarLook: unknown }>('/api/pseudonym/me/avatar', next)
  publish(readLook(avatarLook) ?? next)
}
