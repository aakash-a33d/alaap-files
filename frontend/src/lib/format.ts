/* ============================================================================
   Turning server timestamps into something a person reads.

   The server sends ISO strings in UTC and nothing else. It does not send "2
   hours ago", deliberately: a relative time computed on the server is wrong the
   moment it is cached, and it would also leak the reader's clock into a record
   that is supposed to be about the writer.
   ========================================================================= */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * "just now", "12 minutes ago", "3 days ago".
 *
 * Coarse on purpose. A post is not a message thread, and second-level precision
 * on somebody's worst night reads like surveillance rather than information.
 */
export function relativeTime(iso: string | undefined, now: Date = new Date()): string {
  if (iso === undefined) return ''
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ''

  const delta = now.getTime() - then
  if (delta < MINUTE) return 'just now'
  if (delta < HOUR) {
    const n = Math.floor(delta / MINUTE)
    return `${n} ${n === 1 ? 'minute' : 'minutes'} ago`
  }
  if (delta < DAY) {
    const n = Math.floor(delta / HOUR)
    return `${n} ${n === 1 ? 'hour' : 'hours'} ago`
  }
  const n = Math.floor(delta / DAY)
  return `${n} ${n === 1 ? 'day' : 'days'} ago`
}

/**
 * How long a post has left before it expires.
 *
 * Shown because the five days are a promise rather than a limitation, and a
 * promise nobody can see the edge of is not reassuring. Returns an empty string
 * for a post with no expiry, which is what a paid non-expiring one looks like.
 */
export function timeRemaining(iso: string | undefined, now: Date = new Date()): string {
  if (iso === undefined) return ''
  const until = Date.parse(iso)
  if (!Number.isFinite(until)) return ''

  const left = until - now.getTime()
  if (left <= 0) return 'expired'
  if (left < HOUR) return `${Math.max(1, Math.floor(left / MINUTE))}m left`
  if (left < DAY) return `${Math.floor(left / HOUR)}h left`

  const days = Math.floor(left / DAY)
  const hours = Math.floor((left % DAY) / HOUR)
  return hours > 0 ? `${days}d ${hours}h left` : `${days}d left`
}

/** "12 September 2026". For a journal entry, where the date is the heading. */
export function longDate(iso: string | undefined): string {
  if (iso === undefined) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}
