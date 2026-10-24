import { useEffect, useState } from 'react'
import {
  SEATS,
  SESSION,
  SESSION_MINUTES,
  SPEAKING_CYCLE,
  formatSessionTime,
  nextSessionAt,
} from '../../../content/groups'

/* ============================================================================
   Who has the floor.

   One value, held by the session screen and handed to everything that shows
   it: the circle, the panel that names the speaker, and the roster count. The
   circle used to run its own timer, which meant the panel could say Marlow
   while the middle of the room held somebody else — the screen contradicting
   itself in the one place it is supposed to be telling you where to look.
   ========================================================================= */

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(q.matches)
    const on = () => setReduced(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return reduced
}

/** The seat the session opens on — the person the transcript says is talking,
    so the screen is coherent from its first frame rather than three seconds
    in. */
export const OPENING_SPEAKER = Math.max(
  0,
  SEATS.findIndex((s) => s.id === SESSION.speaker.seat),
)

/** Walks the room's speaking order, pausing on the quiet beat. Stops entirely
    when the viewer has asked for less movement: the circle then holds the
    opening speaker, and every label on the screen still agrees with it. */
export function useSpeakingCycle(enabled: boolean) {
  const reduced = usePrefersReducedMotion()
  const [speaking, setSpeaking] = useState(OPENING_SPEAKER)

  useEffect(() => {
    if (!enabled || reduced) return
    /* Start where the cycle already is, so the first move is the next
       speaker rather than a jump back to the top of the list. */
    let k = Math.max(0, SPEAKING_CYCLE.indexOf(OPENING_SPEAKER))
    const t = window.setInterval(() => {
      k = (k + 1) % SPEAKING_CYCLE.length
      setSpeaking(SPEAKING_CYCLE[k])
    }, 4200)
    return () => window.clearInterval(t)
  }, [enabled, reduced])

  return speaking
}

/* ---------------------------------------------------------------- the clock -- */

export type Unit = { value: string; unit: string }

/** The countdown, ticking. Up to four figures, largest first, dropping days
    once there are none left — so the smallest figure on the card is always
    one that is visibly moving, which is the whole reason to run a clock here
    rather than print three numbers.

    Everything below is derived from one `now`, so the moment the clock passes
    the start time the figures, the button and the state all turn over
    together on the same tick. */
export function useSessionClock() {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const startsAt = nextSessionAt(new Date(now))
  const remaining = startsAt.getTime() - now
  /* Live from the start time until the session has run its length. Late is
     still in the room; there is no door that closes at 7:01. */
  const live = remaining <= 0

  const s = Math.max(0, Math.floor(remaining / 1000))
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')

  const units: Unit[] =
    days > 0
      ? [
          { value: String(days), unit: 'd' },
          { value: pad(hours), unit: 'h' },
          { value: pad(minutes), unit: 'm' },
          { value: pad(seconds), unit: 's' },
        ]
      : hours > 0
        ? [
            { value: String(hours), unit: 'h' },
            { value: pad(minutes), unit: 'm' },
            { value: pad(seconds), unit: 's' },
          ]
        : [
            { value: String(minutes), unit: 'm' },
            { value: pad(seconds), unit: 's' },
          ]

  return {
    startsAt,
    when: formatSessionTime(startsAt),
    live,
    units,
    /** for a screen reader, which should not be read four figures a second */
    spoken: live
      ? 'The session is live now.'
      : `Starts in ${days ? `${days} days, ` : ''}${hours ? `${hours} hours, ` : ''}${minutes} minutes.`,
    minutesLong: SESSION_MINUTES,
  }
}

/** `4 sharing · 4 on avatars` — counted rather than written down, so the line
    and the seats can never drift apart. Sharing rather than "cameras on",
    because what the sentence is actually reporting is how many people chose
    to be seen. */
export const ROOM_COUNT = (() => {
  const sharing = SEATS.filter((s) => s.camera).length
  return `${sharing} sharing · ${SEATS.length - sharing} on avatars`
})()
