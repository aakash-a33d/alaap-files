/* ============================================================================
   Loading something from the server, once, with the three states that actually
   exist.

   No data-fetching library. The app has four screens and React Router already
   code-splits them; a cache layer before there is anything to cache is a
   dependency taken on faith. This is forty lines and does the parts that
   matter — cancellation on unmount, and not writing state after it.

   THE THREE STATES ARE NOT OPTIONAL.

   `loading` is separate from `data === undefined` on purpose. Collapsing them
   makes "still loading" and "there is nothing here" render identically, and on
   this platform that is the difference between a spinner and telling somebody
   their journal is empty.
   ========================================================================= */

import { useCallback, useEffect, useState } from 'react'

export type Async<T> = {
  data: T | undefined
  loading: boolean
  error: unknown
  /** Run it again — after writing something, or after a failure. */
  reload: () => void
}

export function useAsync<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[] = [],
): Async<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(undefined)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    const ac = new AbortController()
    let live = true

    setLoading(true)
    setError(undefined)

    load(ac.signal)
      .then((value) => {
        if (!live) return
        setData(value)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        // An abort is this component going away, not a failure to report.
        if (!live || (cause as Error)?.name === 'AbortError') return
        setError(cause)
        setLoading(false)
      })

    return () => {
      live = false
      ac.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { data, loading, error, reload }
}
