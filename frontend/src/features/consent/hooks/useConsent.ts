/* ============================================================================
   What the member has agreed to.

   Includes withdrawals. The history is kept whole rather than collapsed to a
   current state, because "did I withdraw this, and when" is the question people
   come to this screen to answer, and a list of only live grants cannot answer it.
   ========================================================================= */

import { useAsync, type Async } from '../../../lib/api/useAsync'
import { records, type ConsentRecord } from '../api/consent'

export function useConsentRecords(): Async<ConsentRecord[]> {
  return useAsync((signal) => records(signal), [])
}
