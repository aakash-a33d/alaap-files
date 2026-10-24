import { useState } from 'react'
import { JOIN_STEP, NAME_CHOICES, PRESENCE_CHOICES } from '../../../content/groups'
import { Avatar } from './Avatar'
import { Eyebrow, MONO, PILL_QUIET, PILL_SOLID, Panel, Title } from './parts'

/* ============================================================================
   1h — before you join.

   Anonymity is the default and it is the first card, at full size, with the
   real-name option beside it at the same size. Hiding one behind an "advanced"
   disclosure would be the product quietly stating a preference, and the whole
   claim of group care here is that it does not have one.

   Every choice on this screen is reversible before every session, and the
   screen says so at the top rather than in a help article. The line about
   recording sits at the bottom next to the button that commits, which is
   where somebody actually wonders about it.
   ========================================================================= */

const CARD = 'rounded-[16px] bg-[var(--gr-paper)] p-5 text-left transition-colors'
const CARD_ON = 'border-[1.5px] border-[var(--gr-terra)]'
const CARD_OFF = 'border border-[var(--gr-line-strong)] hover:border-[var(--gr-terra-edge)]'

export function PresenceView({ onBack, onSave }: { onBack: () => void; onSave: () => void }) {
  const [name, setName] = useState<string>(NAME_CHOICES[0].id)
  const [presence, setPresence] = useState<string>(PRESENCE_CHOICES[0].id)

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-5">
      <div>
        <Eyebrow>{JOIN_STEP.eyebrow}</Eyebrow>
        <Title className="mt-2.5">{JOIN_STEP.title}</Title>
        <p className="mt-2 max-w-[58ch] text-[0.82rem] leading-relaxed text-[var(--app-faint)]">
          {JOIN_STEP.note}
        </p>
      </div>

      {/* ---- what the group calls you ------------------------------------ */}
      <fieldset className="border-0 p-0">
        <legend className="sr-only">Your name in the group</legend>
        <Eyebrow>your name in the group</Eyebrow>
        <div role="radiogroup" aria-label="Your name in the group" className="mt-3 grid gap-3.5 sm:grid-cols-2">
          {NAME_CHOICES.map((c) => {
            const on = name === c.id
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setName(c.id)}
                className={`relative ${CARD} ${on ? CARD_ON : CARD_OFF}`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute right-4 top-4 grid h-[19px] w-[19px] place-items-center rounded-full text-[0.66rem] text-white ${
                    on
                      ? 'bg-[var(--gr-terra)]'
                      : 'border-[1.5px] border-[rgb(26_24_20/0.2)] bg-transparent'
                  }`}
                >
                  {on ? '✓' : ''}
                </span>
                <span className="block pr-7 text-[0.9rem] font-semibold text-[var(--app-ink)]">
                  {c.title}
                </span>
                <span className="mt-1.5 block text-[0.76rem] leading-relaxed text-[var(--app-muted)]">
                  {c.body}
                </span>
                <span
                  className={`mt-4 flex items-center gap-2.5 rounded-[11px] bg-[var(--gr-sand)] px-3.5 py-2.5 ${
                    on ? '' : 'opacity-55'
                  }`}
                >
                  <span
                    className={`flex-1 text-[0.86rem] ${
                      on ? 'text-[var(--app-ink)]' : 'text-[var(--app-muted)]'
                    }`}
                  >
                    {c.value}
                  </span>
                  {'flag' in c && c.flag && (
                    <span className={`${MONO} text-[0.6rem] text-[var(--gr-green)]`}>{c.flag}</span>
                  )}
                </span>
                <span className={`${MONO} mt-2 block text-[0.6rem] text-[var(--app-dim)]`}>
                  {c.foot}
                </span>
              </button>
            )
          })}
        </div>
      </fieldset>

      {/* ---- and what they see ------------------------------------------- */}
      <fieldset className="border-0 p-0">
        <legend className="sr-only">How you appear</legend>
        <Eyebrow>how you appear</Eyebrow>
        <div role="radiogroup" aria-label="How you appear" className="mt-3 grid gap-3.5 sm:grid-cols-3">
          {PRESENCE_CHOICES.map((c) => {
            const on = presence === c.id
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPresence(c.id)}
                className={`${CARD} ${on ? CARD_ON : CARD_OFF} text-center`}
              >
                <span className="flex justify-center">
                  {c.id === 'avatar' ? (
                    <Avatar face="wren" size={56} />
                  ) : c.id === 'camera' ? (
                    <span
                      aria-hidden="true"
                      className="block h-14 w-14 rounded-[12px] bg-[var(--gr-sand)] bg-[repeating-linear-gradient(-45deg,rgb(26_24_20/0.1)_0_5px,transparent_5px_10px)]"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className={`${MONO} grid h-14 w-14 place-items-center rounded-full border-[1.5px] border-dashed border-[rgb(26_24_20/0.22)] text-[0.66rem] text-[var(--app-dim)]`}
                    >
                      •••
                    </span>
                  )}
                </span>
                <span className="mt-3 block text-[0.84rem] font-semibold text-[var(--app-ink)]">
                  {c.title}
                </span>
                <span className="mt-1.5 block text-[0.72rem] leading-snug text-[var(--app-muted)]">
                  {c.body}
                </span>
                <span
                  className={`${MONO} mt-2.5 block text-[0.58rem] uppercase tracking-[0.09em] ${
                    c.id === 'avatar' ? 'text-[var(--gr-terra-ink)]' : 'text-[var(--app-dim)]'
                  }`}
                >
                  {c.flag}
                </span>
              </button>
            )
          })}
        </div>
      </fieldset>

      <Panel className="flex flex-wrap items-center justify-between gap-4 p-5">
        <p className="max-w-[52ch] text-[0.74rem] leading-relaxed text-[var(--app-muted)]">
          {JOIN_STEP.privacy}
        </p>
        <div className="flex flex-wrap gap-2.5">
          <button type="button" onClick={onBack} className={PILL_QUIET}>
            Back to avatar
          </button>
          <button type="button" onClick={onSave} className={PILL_SOLID}>
            Save and continue
          </button>
        </div>
      </Panel>
    </div>
  )
}
