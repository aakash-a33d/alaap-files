/* ============================================================================
   What is kept about you, what you agreed to, and how to leave.

   These three sat on the dashboard as buttons with no handler for the whole of
   M8 — the endpoints behind them were built and tested, and nothing called
   them. They are grouped here because they are the same question asked three
   ways, and because the architecture's claim is that they belong beside the
   day's record rather than buried in a settings screen nobody opens.

   THE STEP-UP IS NOT A NUISANCE TO ROUTE AROUND.

   Export and deletion both require a second factor, verified in the last
   fifteen minutes. The panel asks for it at the moment it is needed rather
   than up front, so somebody reading their consent record is not challenged
   for doing nothing dangerous.
   ========================================================================= */

import { useState } from 'react'

import { useConsentRecords } from '../../consent/hooks/useConsent'
import { withdraw as withdrawConsent } from '../../consent/api/consent'
import {
  deleteAccount,
  exportAll,
  needsStepUp,
  stepUpStart,
  stepUpVerify,
  type DeletionReceipt,
} from '../api/dataRights'

type Section = 'consent' | 'data'

export function AccountPanel({
  section,
  onClose,
}: {
  section: Section
  onClose: () => void
}) {
  const consent = useConsentRecords()

  /* The step-up, held here rather than per action: one verification covers both
     export and deletion for its fifteen minutes, which is what the gateway
     already decided when it scoped the assertion to the route group. */
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [devCode, setDevCode] = useState<string | undefined>(undefined)
  const [code, setCode] = useState('')
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState<'step' | 'export' | 'delete' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<DeletionReceipt | null>(null)
  const [confirmText, setConfirmText] = useState('')

  async function beginStepUp() {
    setBusy('step')
    setMessage(null)
    try {
      const challenge = await stepUpStart()
      setChallengeId(challenge.challengeId)
      setDevCode(challenge.devCode)
    } catch {
      setMessage('We could not send a code just now. Try again in a moment.')
    } finally {
      setBusy(null)
    }
  }

  async function finishStepUp() {
    if (challengeId === null) return
    setBusy('step')
    setMessage(null)
    try {
      await stepUpVerify({ challengeId, code })
      setVerified(true)
      setChallengeId(null)
      setCode('')
    } catch {
      setMessage('That code was not right, or it has expired. Ask for a new one.')
    } finally {
      setBusy(null)
    }
  }

  /**
   * Hand the file over.
   *
   * Built in the browser from what the server returned and offered as a download.
   * It is never written to disk by the platform: assembling it on demand is what
   * keeps "asking for your data" from creating a second copy of it.
   */
  async function runExport() {
    setBusy('export')
    setMessage(null)
    try {
      const data = await exportAll()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `alaap-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setMessage('Downloaded. Everything in that file was written by you.')
    } catch (err) {
      setMessage(
        needsStepUp(err)
          ? 'Verify it is you first, above.'
          : 'The export could not be built just now. Nothing was sent anywhere.',
      )
    } finally {
      setBusy(null)
    }
  }

  async function runDelete() {
    setBusy('delete')
    setMessage(null)
    try {
      setReceipt(await deleteAccount())
    } catch (err) {
      setMessage(
        needsStepUp(err)
          ? 'Verify it is you first, above.'
          : 'The deletion could not be completed. Nothing was removed.',
      )
    } finally {
      setBusy(null)
    }
  }

  /* After a deletion there is no account to return to, so the panel becomes the
     receipt and the only way on is out. */
  if (receipt !== null) {
    return (
      <Shell title="Your account is gone" onClose={() => window.location.assign('/')}>
        <p className="text-[0.86rem] leading-relaxed text-[var(--app-body)]">{receipt.message}</p>
        <ul className="mt-4 flex flex-col gap-2">
          {receipt.receipt.map((r) => (
            <li
              key={r.service}
              className="rounded-[12px] bg-[var(--app-sunken)] px-3.5 py-2.5 text-[0.8rem]"
            >
              <span className="font-medium text-[var(--app-ink)]">{label(r.service)}</span>
              <span className="text-[var(--app-muted)]">
                {' — '}
                {r.outcome === 'purged'
                  ? `deleted${r.purged ? ` (${r.purged} ${r.purged === 1 ? 'record' : 'records'})` : ''}`
                  : r.outcome === 'held'
                    ? 'kept for now'
                    : 'could not be cleared'}
              </span>
              {r.detail !== null && (
                <p className="mt-1 text-[0.76rem] leading-relaxed text-[var(--app-body)]">
                  {r.detail}
                </p>
              )}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => window.location.assign('/')}
          className="mt-5 min-h-11 w-full rounded-full bg-[var(--app-ink)] text-[0.8rem] font-semibold text-[var(--app-rail)]"
        >
          Close
        </button>
      </Shell>
    )
  }

  if (section === 'consent') {
    return (
      <Shell title="What you have agreed to" onClose={onClose}>
        {consent.loading && <Muted>Loading</Muted>}
        {!consent.loading && (consent.data ?? []).length === 0 && (
          <Muted>
            You have not agreed to anything yet. Nothing is processed until you do.
          </Muted>
        )}
        <ul className="flex flex-col gap-2.5">
          {(consent.data ?? []).map((r) => (
            <li
              key={r.id}
              className="rounded-[12px] border border-[rgb(26_24_20/0.08)] bg-[var(--app-sunken)] px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[0.84rem] font-medium text-[var(--app-ink)]">
                  {purposeLabel(r.purpose)}
                </p>
                <span className="text-[0.72rem] text-[var(--app-muted)]">
                  {r.state === 'withdrawn' ? 'Withdrawn' : 'Active'}
                </span>
              </div>
              <p className="mt-1 text-[0.74rem] text-[var(--app-dim)]">
                Agreed {new Date(r.grantedAt).toLocaleDateString()}
                {r.withdrawnAt !== null &&
                  ` · stopped ${new Date(r.withdrawnAt).toLocaleDateString()}`}
              </p>
              {r.state !== 'withdrawn' && (
                <button
                  type="button"
                  onClick={() => {
                    void withdrawConsent(r.purpose).then(() => consent.reload())
                  }}
                  className="mt-3 min-h-10 rounded-full border border-[rgb(26_24_20/0.14)] px-4 text-[0.76rem] font-semibold text-[var(--app-ink)]"
                >
                  Stop this
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[0.76rem] leading-relaxed text-[var(--app-dim)]">
          Stopping something does not delete anything you have already written. You can
          still read it, take a copy and delete it yourself.
        </p>
      </Shell>
    )
  }

  return (
    <Shell title="What is kept about you" onClose={onClose}>
      {!verified && (
        <div className="rounded-[12px] border border-dashed border-[rgb(26_24_20/0.16)] px-4 py-3.5">
          <p className="text-[0.82rem] leading-relaxed text-[var(--app-body)]">
            Taking a copy of everything, or deleting your account, needs one more check
            that it is you — a code to the number on your account. A stolen session must
            not be able to do either of these.
          </p>
          {challengeId === null ? (
            <button
              type="button"
              onClick={() => void beginStepUp()}
              disabled={busy !== null}
              className="mt-3 min-h-11 rounded-full bg-[var(--app-ink)] px-5 text-[0.78rem] font-semibold text-[var(--app-rail)] disabled:opacity-50"
            >
              {busy === 'step' ? 'Sending…' : 'Send me a code'}
            </button>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {devCode !== undefined && (
                <span className="rounded-[8px] border border-dashed border-[rgb(26_24_20/0.2)] px-2 py-1 font-[family-name:var(--font-mono)] text-[0.78rem]">
                  dev {devCode}
                </span>
              )}
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="000000"
                aria-label="Six-digit code"
                className="min-h-11 w-[9rem] rounded-full border border-[rgb(26_24_20/0.14)] bg-[var(--app-sunken)] px-4 font-[family-name:var(--font-mono)] tracking-[0.3em]"
              />
              <button
                type="button"
                onClick={() => void finishStepUp()}
                disabled={busy !== null || code.length !== 6}
                className="min-h-11 rounded-full bg-[var(--app-ink)] px-5 text-[0.78rem] font-semibold text-[var(--app-rail)] disabled:opacity-40"
              >
                Verify
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 rounded-[12px] bg-[var(--app-sunken)] px-4 py-3.5">
        <p className="text-[0.84rem] font-medium text-[var(--app-ink)]">Take a copy</p>
        <p className="mt-1 text-[0.78rem] leading-relaxed text-[var(--app-body)]">
          Your posts, replies, journal entries, mood check-ins and consent records, as a
          file. Replies other people wrote to you are not included — those are their
          words.
        </p>
        <button
          type="button"
          onClick={() => void runExport()}
          disabled={!verified || busy !== null}
          className="mt-3 min-h-11 rounded-full border border-[rgb(26_24_20/0.16)] px-5 text-[0.78rem] font-semibold text-[var(--app-ink)] disabled:opacity-40"
        >
          {busy === 'export' ? 'Building…' : 'Download my data'}
        </button>
      </div>

      <div className="mt-3 rounded-[12px] border border-[rgb(176_64_48/0.3)] bg-[rgb(176_64_48/0.05)] px-4 py-3.5">
        <p className="text-[0.84rem] font-medium text-[var(--app-ink)]">Delete everything</p>
        <p className="mt-1 text-[0.78rem] leading-relaxed text-[var(--app-body)]">
          Your account, your posts, your replies, your journal and your handle. This
          cannot be undone and takes effect immediately. The audit trail keeps a record
          that a deletion happened — it holds none of what you wrote, and once your
          handle is gone it points at nobody.
        </p>
        <label className="mt-3 block text-[0.76rem] text-[var(--app-dim)]">
          Type DELETE to confirm
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            aria-label="Type DELETE to confirm"
            className="mt-1 block min-h-11 w-full rounded-full border border-[rgb(26_24_20/0.14)] bg-[var(--app-rail)] px-4 text-[0.82rem] tracking-[0.1em] text-[var(--app-ink)]"
          />
        </label>
        <button
          type="button"
          onClick={() => void runDelete()}
          disabled={!verified || busy !== null || confirmText !== 'DELETE'}
          className="mt-3 min-h-11 rounded-full bg-[rgb(142_46_34)] px-5 text-[0.78rem] font-semibold text-white disabled:opacity-40"
        >
          {busy === 'delete' ? 'Deleting…' : 'Delete my account'}
        </button>
      </div>

      {message !== null && (
        <p role="status" className="mt-4 text-[0.8rem] leading-relaxed text-[var(--app-body)]">
          {message}
        </p>
      )}
    </Shell>
  )
}

/* ------------------------------------------------------------------ bits -- */

function Shell({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 grid place-items-center bg-[rgb(26_24_20/0.45)] p-4"
    >
      <div className="max-h-[86svh] w-full max-w-[32rem] overflow-y-auto rounded-[18px] bg-[var(--app-rail)] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-[1.05rem] font-semibold text-[var(--app-ink)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-h-10 min-w-10 rounded-full text-[var(--app-faint)] hover:text-[var(--app-ink)]"
          >
            ✕
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}

const Muted = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[0.82rem] leading-relaxed text-[var(--app-muted)]">{children}</p>
)

/** The purpose ids are kebab-case; these are the words members were shown. */
function purposeLabel(purpose: string): string {
  switch (purpose) {
    case 'care-delivery':
      return 'Keeping what you write privately'
    case 'community-moderation':
      return 'Checking replies before they reach someone'
    case 'crisis-triage':
      return 'Checking whether you might be in danger'
    case 'notification-delivery':
      return 'Telling you when something happens'
    default:
      return purpose
  }
}

function label(service: string): string {
  switch (service) {
    case 'community-service':
      return 'Posts and replies'
    case 'clinical-vault-service':
      return 'Journal and mood'
    case 'consent-service':
      return 'Consent records'
    case 'auth-service':
      return 'Account and sessions'
    case 'pseudonym-service':
      return 'Your handle'
    default:
      return service
  }
}
