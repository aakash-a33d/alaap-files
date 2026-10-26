import { useSyncExternalStore } from 'react'
import { api } from '../../../lib/api/client'
import { ApiError } from '../../../lib/api/errors'

/* ============================================================================
   The name the member goes by in one group.

   Typed once, before their first session in that group, then fixed for every
   session of it. A new group is a new name. The server holds it per group
   (pseudonym-service, /api/pseudonym/me/groups/:id/name) and refuses a
   second write, so "locked" here is what the server says, not a flag kept in
   the browser.

   Held once per group for the page, because the circle, the chat, the week
   card and the setup dialog all show it and must agree mid-save.
   ========================================================================= */

export const GROUP_NAME_MAX = 24

/** Same rule as pseudonym-service (src/domain/group-name.ts): letters in any
    script, with the spaces, hyphens, apostrophes and full stops real names
    use. No digits and no @, which is what a phone number, an email or a
    username elsewhere would need. */
const NAME = /^[\p{L}\p{M}](?:[\p{L}\p{M} '.-]*[\p{L}\p{M}.])?$/u

export function tidyName(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ')
}

/** Why a typed name would be refused, in the member's words, or undefined if
    it is fine. */
export function nameProblem(raw: string): string | undefined {
  const name = tidyName(raw)
  if (!name) return 'Type the name you want the group to call you.'
  if (name.length > GROUP_NAME_MAX) return `Keep it to ${GROUP_NAME_MAX} characters or fewer.`
  if (/[0-9@]/.test(name)) return 'Letters only. No numbers or @, so nobody can find you outside the group.'
  if (!NAME.test(name)) return 'Use letters, with spaces, hyphens or apostrophes between them.'
  return undefined
}

export type GroupNameState =
  | { status: 'loading' }
  | { status: 'unset' }
  | { status: 'locked'; name: string; setAt: string }
  | { status: 'error' }

const states = new Map<string, GroupNameState>()
const requested = new Set<string>()
const listeners = new Set<() => void>()
const LOADING: GroupNameState = { status: 'loading' }

function publish(groupId: string, next: GroupNameState) {
  states.set(groupId, next)
  for (const l of listeners) l()
}

function load(groupId: string) {
  if (requested.has(groupId)) return
  requested.add(groupId)
  api
    .get<{ name: string | null; setAt?: string }>(`/api/pseudonym/me/groups/${groupId}/name`)
    .then((r) =>
      publish(
        groupId,
        r.name ? { status: 'locked', name: r.name, setAt: r.setAt ?? '' } : { status: 'unset' },
      ),
    )
    .catch(() => {
      /* allow a later retry; the caller shows the name as not yet known */
      requested.delete(groupId)
      publish(groupId, { status: 'error' })
    })
}

export function useGroupName(groupId: string): GroupNameState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      load(groupId)
      return () => listeners.delete(l)
    },
    () => states.get(groupId) ?? LOADING,
  )
}

/** The member's name in this group for display, or `fallback` until they
    have set one. */
export function useMyGroupName(groupId: string, fallback = 'You'): string {
  const s = useGroupName(groupId)
  return s.status === 'locked' ? s.name : fallback
}

/** Set the name for this group. Resolves with the name that now stands. If
    the member had already set one (on another device, say), that one stands
    and is returned, and this call does not change it. */
export async function lockGroupName(groupId: string, raw: string): Promise<string> {
  try {
    const r = await api.post<{ name: string; setAt: string }>(
      `/api/pseudonym/me/groups/${groupId}/name`,
      { name: tidyName(raw) },
    )
    publish(groupId, { status: 'locked', name: r.name, setAt: r.setAt })
    return r.name
  } catch (err) {
    if (err instanceof ApiError && err.code === 'name_locked') {
      const d = err.detail as { name?: string; setAt?: string }
      if (d.name) {
        publish(groupId, { status: 'locked', name: d.name, setAt: d.setAt ?? '' })
        return d.name
      }
    }
    throw err
  }
}
