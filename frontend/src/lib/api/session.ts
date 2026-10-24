/* ============================================================================
   Who is signed in.

   The client holds no token and therefore cannot answer this by inspecting
   anything locally. It asks the server, which is the only thing that knows —
   a session can be revoked from another device at any moment, and a client
   that decided "signed in" from a value in its own memory would keep saying so
   until the next request failed.

   That makes 401 the signal, not an error to swallow. `whoAmI` returns
   undefined for a signed-out visitor rather than throwing, because "nobody is
   signed in" is an ordinary state of the application and not a fault.
   ========================================================================= */

import { api } from './client'
import { ApiError } from './errors'

export type Persona = {
  /** e.g. "QuietRiver-4821". One per mobile number, permanent. */
  handle: string
  pseudoId: number
}

export type Me = {
  persona: Persona
}

/**
 * The signed-in member, or undefined.
 *
 * `/api/pseudonym/me` is the right question to ask: the pseudonym IS the
 * identity everywhere the member is visible, and the account behind it is
 * deliberately not reachable from the browser.
 */
export async function whoAmI(signal?: AbortSignal): Promise<Persona | undefined> {
  try {
    const { persona } = await api.get<Me>('/api/pseudonym/me', signal ? { signal } : {})
    return persona
  } catch (err) {
    if (err instanceof ApiError && (err.isUnauthenticated || err.status === 404)) return undefined
    throw err
  }
}

/**
 * Sign out.
 *
 * Answered by the gateway itself rather than a service: it holds the cookie and
 * the session store, and the proxy strips the token before forwarding so no
 * downstream service can see which session to end.
 *
 * Never throws. A member who presses "sign out" gets a signed-out browser — if
 * the request fails, the right response is still to treat them as signed out
 * and let the session expire on its own, not to leave them looking at a signed-in
 * screen they asked to leave.
 */
export async function signOut(): Promise<void> {
  try {
    await api.post<{ revoked: boolean }>('/api/auth/logout')
  } catch {
    /* see above */
  }
}
