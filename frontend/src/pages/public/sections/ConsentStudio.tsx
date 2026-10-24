import { useState } from 'react'
import {
  CONSENT_RECORD,
  CONSENT_VIEWERS,
  type ConsentState,
} from '../../../content/site'
import { Reveal } from '../../../components/ui/Reveal'

/* ============================================================================
   CONSENT STUDIO

   Consent on this platform is per-record, per-purpose and withdrawable, which
   is a hard thing to convey in prose — so this lets you operate it. Flip the
   three switches that genuinely exist on a clinical record and the panel
   recomputes what every party can see. The rules come from the consent policy
   engine in the architecture, not from marketing copy.

   The third switch is the purpose-limitation case: it grants a single day's
   read for one stated purpose and retains nothing, which is why it is separate
   from the theme-extraction switch above it rather than folded into it.
   ========================================================================= */

const LEVEL_STYLE: Record<string, string> = {
  full: 'text-safe',
  partial: 'text-accent',
  /* muted rather than faint — at 10px uppercase, faint measured 4.6:1, which
     passes AA but leaves nothing in hand */
  none: 'text-muted',
}

const LEVEL_LABEL: Record<string, string> = {
  full: 'Full access',
  partial: 'Limited',
  none: 'No access',
}

function Switch({
  on,
  onChange,
  label,
  hint,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
  hint: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={[
        'group flex w-full items-start gap-4 rounded-[var(--radius-lg)] border p-4 text-left transition-colors duration-200',
        on
          ? 'border-[var(--border-seam)] bg-[var(--accent-wash)]'
          : 'border-[var(--border)] bg-transparent hover:border-[var(--border-strong)]',
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className={[
          'mt-0.5 flex h-6 w-11 flex-none items-center rounded-full p-0.5 transition-colors duration-200',
          on ? 'bg-[var(--gold-600)]' : 'bg-[var(--border-strong)]',
        ].join(' ')}
      >
        <span
          className={[
            'h-5 w-5 rounded-full bg-[var(--paper-50)] transition-transform duration-200',
            on ? 'translate-x-5' : 'translate-x-0',
          ].join(' ')}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[0.95rem] font-semibold text-ink">{label}</span>
        <span className="mt-1 block text-[0.82rem] leading-snug text-muted">
          {hint}
        </span>
      </span>
    </button>
  )
}

export function ConsentStudio() {
  const [state, setState] = useState<ConsentState>({
    therapist: false,
    ai: false,
    practice: false,
  })

  return (
    <section
      id="consent"
      aria-labelledby="consent-title"
      className="theme-light relative border-t border-[var(--border)] bg-sunken"
    >
      <div className="px-[clamp(1.1rem,4vw,4rem)] py-[clamp(4rem,8vw,7rem)]">
        {/* heading spans wide rather than sitting in a left column */}
        <Reveal className="grid gap-x-16 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <p className="u-eyebrow">Consent-bound AI</p>
            <h2 id="consent-title" className="u-h2 mt-5">
              Nothing is analysed<br />until you say so.
            </h2>
          </div>
          <p className="u-lede lg:pb-2">
            Consent here is not a single checkbox in a settings page — it is
            attached to each individual record, and you can withdraw it. Operate
            the switches below and watch who gains and loses sight of one
            journal entry.
          </p>
        </Reveal>

        {/* ------------------------------------------------- the studio --- */}
        <div className="mt-[clamp(2.5rem,5vw,4rem)] grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          {/* the record */}
          <div className="card flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="chip chip--accent">{CONSENT_RECORD.id}</span>
              <span className="u-label text-[0.6rem]">
                {CONSENT_RECORD.kind} · {CONSENT_RECORD.date}
              </span>
            </div>

            <blockquote className="text-[clamp(1rem,1.4vw,1.15rem)] leading-relaxed text-ink/90">
              {CONSENT_RECORD.excerpt}
            </blockquote>

            <div className="mt-auto grid gap-3">
              <Switch
                on={state.therapist}
                onChange={(v) => setState((s) => ({ ...s, therapist: v }))}
                label="Share with my therapist"
                hint="This entry only. Other entries stay closed."
              />
              <Switch
                on={state.ai}
                onChange={(v) => setState((s) => ({ ...s, ai: v }))}
                label="Allow AI to find themes in it"
                hint="Decrypted briefly, summarised, plaintext destroyed. Never used for training."
              />
              <Switch
                on={state.practice}
                onChange={(v) => setState((s) => ({ ...s, practice: v }))}
                label="Let AI suggest an exercise today"
                hint="One read, today only, to pick a breathing or grounding step. No summary kept."
              />
            </div>

            <p className="text-[0.78rem] leading-snug text-faint">
              All three are off by default and independent of each other —
              allowing today's exercise is not permission to build a picture of
              you. Turning one off revokes access from that moment, including
              any summary already produced.
            </p>
          </div>

          {/* who sees what */}
          <div className="card">
            <p className="u-label mb-1 text-[0.62rem]">
              Who can see it right now
            </p>

            <ul className="divide-y divide-[var(--border)]">
              {CONSENT_VIEWERS.map((v) => {
                const r = v.sees(state)
                return (
                  <li key={v.id} className="flex items-start gap-4 py-4">
                    <span
                      aria-hidden="true"
                      className={[
                        'mt-1 h-2 w-2 flex-none rounded-full',
                        r.level === 'full'
                          ? 'bg-[var(--sage-600)]'
                          : r.level === 'partial'
                            ? 'bg-[var(--gold-600)]'
                            : 'bg-[var(--stone-400)]',
                      ].join(' ')}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="text-[0.95rem] font-semibold text-ink">
                          {v.label}
                        </span>
                        <span
                          className={[
                            'font-[family-name:var(--font-mono)] text-[0.65rem] uppercase tracking-wider',
                            LEVEL_STYLE[r.level],
                          ].join(' ')}
                        >
                          {LEVEL_LABEL[r.level]}
                        </span>
                      </span>
                      <span className="mt-1 block text-[0.84rem] leading-snug text-muted">
                        {r.detail}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
