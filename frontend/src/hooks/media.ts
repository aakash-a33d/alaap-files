import { useEffect, useState } from 'react'

/** Subscribes to a media query and re-renders on change. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** True when the visitor has asked the OS to reduce motion. */
export const useReducedMotion = () =>
  useMediaQuery('(prefers-reduced-motion: reduce)')

/** True on touch-first / small viewports. */
export const useIsSmall = () => useMediaQuery('(max-width: 767px)')
