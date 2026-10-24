/* ============================================================================
   Journal and mood.

   Two hooks, gated completely differently, and the difference is deliberate:
   the journal is a paid feature behind per-record consent, and mood is free on
   every plan and never gated by anything.

   `useJournal` surfaces its error rather than swallowing it, because the errors
   ARE the interface here: 402 is a plan, 429 is an allowance, 451 is a consent
   the member withdrew. See lib/api/errors.ts.
   ========================================================================= */

import { useAsync, type Async } from '../../../lib/api/useAsync'
import { list, moodHistory, type JournalSummary, type MoodCheckin } from '../api/journal'

/** Dates and word counts. No bodies — a list decrypts nothing. */
export function useJournalList(): Async<JournalSummary[]> {
  return useAsync((signal) => list(signal), [])
}

export function useMoodHistory(days = 30): Async<MoodCheckin[]> {
  return useAsync((signal) => moodHistory(days, signal), [days])
}
