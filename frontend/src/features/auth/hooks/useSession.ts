/* ============================================================================
   Who is signed in, for the components that need to know.

   The answer comes from the server every time the app loads, because it is the
   only thing that knows: a session can be revoked from another device at any
   moment, and this client holds no token it could inspect even if it wanted to.

   `member === undefined` once `loading` is false means signed out. That is an
   ordinary state of the application, not an error, and screens are expected to
   render it rather than throw.
   ========================================================================= */

import { useCallback } from 'react'

import { useAsync } from '../../../lib/api/useAsync'
import { signOut as endSession, whoAmI, type Persona } from '../../../lib/api/session'

export type Session = {
  member: Persona | undefined
  loading: boolean
  /** Sign out and re-ask the server. Never throws. */
  signOut: () => Promise<void>
  reload: () => void
}

export function useSession(): Session {
  const { data, loading, reload } = useAsync<Persona | undefined>((signal) => whoAmI(signal), [])

  const signOut = useCallback(async () => {
    await endSession()
    // Re-ask rather than assuming. If revocation failed the member is still
    // signed in, and showing them a signed-out screen would be a second lie on
    // top of the first.
    reload()
  }, [reload])

  return { member: data, loading, signOut, reload }
}
