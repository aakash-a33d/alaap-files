/* ============================================================================
   The journal and the mood check-in.

   Two surfaces in the same vault, gated completely differently, and the
   difference is a decision rather than an accident:

     journal      PAID. Unbounded, non-expiring, envelope-encrypted per record,
                  a KMS operation on every read. Real ongoing cost.
     mood         FREE on every plan, and never gated — not by plan, not by
                  quota, not by consent. A single number costs nothing, and it
                  is the lowest-friction way for somebody to begin at all.

   A LIST DOES NOT DECRYPT ANYTHING. `list` returns dates and word counts with
   no bodies, because rendering a feed of entries would mean a KMS call per row
   and an audit event per row for content nobody asked to read. `read` is the
   only call that opens an entry, and every one of those is audited — including
   when it is the member themselves, because a trail with gaps for the ordinary
   case proves nothing about the extraordinary one.
   ========================================================================= */

import { api } from '../../../lib/api/client'

/** What a list row carries. No body — see above. */
export type JournalSummary = {
  id: string
  entryDate: string
  wordCount: number
  privacyMode: string
  createdAt: string
}

export type JournalEntry = JournalSummary & {
  body: string
}

export type MoodCheckin = {
  id: string
  moodScore: number
  energyScore?: number
  sleepHours?: number
  stressScore?: number
  emotionTags: string[]
  entryDate: string
}

/* ------------------------------------------------------------- journal -- */

export async function list(signal?: AbortSignal): Promise<JournalSummary[]> {
  const { entries } = await api.get<{ entries: JournalSummary[] }>(
    '/api/journal/entries',
    signal ? { signal } : {},
  )
  return entries
}

export async function read(id: string, signal?: AbortSignal): Promise<JournalEntry> {
  const { entry } = await api.get<{ entry: JournalEntry }>(
    `/api/journal/entries/${encodeURIComponent(id)}`,
    signal ? { signal } : {},
  )
  return entry
}

/**
 * Write an entry.
 *
 * Three refusals reach here and they mean different things — see
 * lib/api/errors.ts. In particular a 451 is consent, not quota: the member asked
 * us to stop and we did. Telling them they have run out of entries at that
 * moment would be telling them that asserting control costs them a feature.
 */
export async function write(
  input: { body: string; entryDate?: string },
  signal?: AbortSignal,
): Promise<JournalEntry> {
  const { entry } = await api.post<{ entry: JournalEntry }>(
    '/api/journal/entries',
    input,
    signal ? { signal } : {},
  )
  return entry
}

/**
 * Delete one.
 *
 * Always available, on every plan, and unaffected by consent state. Withdrawing
 * consent stops new processing and destroys nothing; deleting is the separate
 * act, and it has to stay reachable from a withdrawn state or "your entries are
 * still yours" is not true.
 */
export async function remove(id: string): Promise<void> {
  await api.del<void>(`/api/journal/entries/${encodeURIComponent(id)}`)
}

/* ---------------------------------------------------------------- mood -- */

/**
 * Record today.
 *
 * Writing twice in one day replaces rather than appends. A mood check-in is a
 * statement about a day, not an event log, and a member correcting theirs is
 * not creating a second day.
 */
export async function recordMood(
  input: {
    moodScore: number
    energyScore?: number
    sleepHours?: number
    stressScore?: number
    emotionTags?: string[]
  },
  signal?: AbortSignal,
): Promise<MoodCheckin> {
  const { checkin } = await api.post<{ checkin: MoodCheckin }>(
    '/api/mood/checkins',
    input,
    signal ? { signal } : {},
  )
  return checkin
}

export async function moodHistory(days = 30, signal?: AbortSignal): Promise<MoodCheckin[]> {
  const { checkins } = await api.get<{ checkins: MoodCheckin[] }>('/api/mood/checkins', {
    query: { days },
    ...(signal ? { signal } : {}),
  })
  return checkins
}
