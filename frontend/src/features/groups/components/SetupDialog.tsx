import { useEffect, useRef, useState } from 'react'
import { AvatarBuilderView } from './AvatarBuilderView'
import { PresenceView } from './PresenceView'
import { Eyebrow, MONO } from './parts'

/* ============================================================================
   Setting up how you appear — 1i and 1h, as one thing you do once.

   These were tabs for a while, which was wrong twice over: they are not places
   you return to, and putting them in a permanent nav implied a member could
   sensibly wander into "before you join" without a session to join. They are a
   two-step setup, so they are a dialog — opened from your profile when you
   want to change something, and opened *for* you the first time you try to
   enter a room without having answered either question.

   The order is deliberate. Build the stand-in first, then decide whether the
   group sees it, because the second question is much easier to answer once
   there is something to look at.
   ========================================================================= */

export type SetupStep = 'avatar' | 'presence'

export function SetupDialog({
  open,
  step,
  onStep,
  onClose,
  onComplete,
  /** what happens after the last step — joining the room they were headed for */
  completeLabel,
}: {
  open: boolean
  step: SetupStep
  onStep: (s: SetupStep) => void
  onClose: () => void
  onComplete: () => void
  completeLabel?: string
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  /* Escape closes it, and the panel takes focus when it opens so the next Tab
     lands inside the dialog rather than back in the page behind it. */
  useEffect(() => {
    if (!open) {
      setMounted(false)
      return
    }
    setMounted(true)
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="gr-room fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgb(26_24_20/0.42)] p-4 sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="How you appear in group sessions"
        tabIndex={-1}
        className={`w-full max-w-[980px] rounded-[24px] bg-[var(--app-ground)] shadow-[0_24px_60px_rgb(26_24_20/0.32)] outline-none transition-opacity duration-200 ${
          mounted ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--gr-line)] px-6 py-4">
          <div className="flex items-center gap-3">
            <Eyebrow>set up group sessions</Eyebrow>
            <ol className="flex items-center gap-2">
              {(['avatar', 'presence'] as const).map((s, i) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => onStep(s)}
                    aria-current={step === s ? 'step' : undefined}
                    className={`${MONO} inline-flex min-h-8 items-center rounded-full px-3 text-[0.6rem] uppercase tracking-[0.1em] transition-colors ${
                      step === s
                        ? 'bg-[var(--app-ink)] text-[var(--app-rail)]'
                        : 'text-[var(--app-dim)] hover:bg-[rgb(26_24_20/0.06)]'
                    }`}
                  >
                    {i + 1} · {s === 'avatar' ? 'your avatar' : 'before you join'}
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-9 items-center rounded-full border border-[var(--gr-line-strong)] px-4 text-[0.76rem] text-[var(--app-muted)] transition-colors hover:bg-[rgb(26_24_20/0.05)]"
          >
            Close
          </button>
        </header>

        <div className="p-4 sm:p-6">
          {step === 'avatar' ? (
            <AvatarBuilderView onNext={() => onStep('presence')} onSkip={() => onStep('presence')} />
          ) : (
            <PresenceView onBack={() => onStep('avatar')} onSave={onComplete} />
          )}
        </div>

        {completeLabel && step === 'presence' && (
          <p className="border-t border-[var(--gr-line)] px-6 py-3 text-[0.74rem] text-[var(--app-muted)]">
            {completeLabel}
          </p>
        )}
      </div>
    </div>
  )
}
