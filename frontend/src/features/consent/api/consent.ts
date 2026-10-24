/* ============================================================================
   What you agreed to, and how to stop.

   THE PURPOSE IS IN THE PATH, NOT THE BODY.

   The gateway refuses any request carrying a `purpose` field in its body or
   query — a caller that can declare its own purpose defeats purpose limitation
   entirely, so it is treated as smuggling and answered 400. Consent is the one
   place a purpose is legitimately the SUBJECT of a request rather than a claim
   about why the caller is calling, and putting it in the path keeps that
   distinction without carving an exception into the gateway's rule.

   GRANTING AND WITHDRAWING ARE NOT SYMMETRIC.

   Granting can fail: an unregistered purpose, or one with no published text, is
   refused, because consent that points at nothing cannot answer "what did they
   agree to". Withdrawing cannot fail and is never gated by plan or payment. A
   member who cannot stop has not consented, they have been enrolled.
   ========================================================================= */

import { api } from '../../../lib/api/client'

export type ConsentRecord = {
  id: string
  purpose: string
  /** 'granted' | 'withdrawn' */
  state: string
  /** Which text they agreed to. Version 2 is not version 5. */
  versionId: string
  grantedAt: string
  withdrawnAt: string | null
}

/**
 * Everything, including what was withdrawn.
 *
 * The withdrawal is kept beside the grant rather than overwriting it. A history
 * that shows only the current state cannot show somebody that they withdrew, or
 * when — which is the thing they came to this screen to check.
 */
export async function records(signal?: AbortSignal): Promise<ConsentRecord[]> {
  const { records: list } = await api.get<{ records: ConsentRecord[] }>(
    '/api/consent/records',
    signal ? { signal } : {},
  )
  return list
}

export async function grant(purpose: string): Promise<ConsentRecord> {
  const { record } = await api.post<{ record: ConsentRecord }>(
    `/api/consent/grant/${encodeURIComponent(purpose)}`,
  )
  return record
}

/**
 * Stop.
 *
 * Returns the server's own sentence about what this does and does not mean, and
 * the UI should show it rather than paraphrasing: it is the one place the
 * platform promises, in writing, that nothing already written was removed.
 *
 * Answers identically whether or not anything was granted. Withdrawing twice is
 * not an error, and the difference would disclose what had been consented to.
 */
export async function withdraw(purpose: string): Promise<{ withdrawn: boolean; message: string }> {
  return api.post<{ withdrawn: boolean; message: string }>(
    `/api/consent/withdraw/${encodeURIComponent(purpose)}`,
  )
}
