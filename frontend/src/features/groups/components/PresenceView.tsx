import { useState } from 'react'
import { GROUP, JOIN_STEP, NAME_STEP, PRESENCE_CHOICES } from '../../../content/groups'
import { GROUP_NAME_MAX, lockGroupName, nameProblem, useGroupName } from '../model/groupName'
import { useMyLook } from '../model/myLook'
import { Avatar } from './Avatar'
import { Eyebrow, MONO, PILL_QUIET, PILL_SOLID, Panel, Title } from './parts'

/* ============================================================================
   1h — before you join.

   The member's name in the group is one text box. It takes a made-up name or
   a real first name alike, and the screen never asks which: offering the two
   as separate options would be the product quietly stating a preference.

   The name is set once per group and then locked for every session of it,
   because a closed group comes to know each other by these names over the
   whole cycle. The box says so before the member commits, not after. How they
   appear (avatar, camera, listening) stays changeable before every session.
   The line about recording sits at the bottom next to the button that
   commits, which is where somebody actually wonders about it.
   ========================================================================= */

const SAVE_ERROR = "Couldn't save your name just now. It's still here, so try again."

const CARD = 'rounded-[16px] bg-[var(--gr-paper)] p-5 text-left transition-colors'
const CARD_ON = 'border-[1.5px] border-[var(--gr-terra)]'
const CARD_OFF = 'border border-[var(--gr-line-strong)] hover:border-[var(--gr-terra-edge)]'

export function PresenceView({ onBack, onSave }: { onBack: () => void; onSave: () => void }) {
  const [presence, setPresence] = useState<string>(PRESENCE_CHOICES[0].id)
  const myLook = useMyLook()
  const nameState = useGroupName(GROUP.id)
  const [draft, setDraft] = useState('')
  /* A problem is shown once the member tries to continue, not while they are
     still typing the first letter. */
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const problem = nameProblem(draft)
  const showProblem = tried && problem !== undefined

  async function save() {
    if (nameState.status === 'locked') {
      onSave()
      return
    }
    setTried(true)
    if (problem) return
    setSaving(true)
    setSaveError(false)
    try {
      await lockGroupName(GROUP.id, draft)
      onSave()
    } catch {
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-5">
      <div>
        <Eyebrow>{JOIN_STEP.eyebrow}</Eyebrow>
        <Title className="mt-2.5">{JOIN_STEP.title}</Title>
        <p className="mt-2 max-w-[58ch] text-[0.82rem] leading-relaxed text-[var(--app-faint)]">
          {JOIN_STEP.note}
        </p>
      </div>

      {/* ---- what the group calls you ------------------------------------
          One box. Whether it holds a made-up name or a real first name is the
          member's business, so the screen does not ask which. Once the group
          has a name for them it is shown, locked, for the rest of the group. */}
      <div>
        <label htmlFor="group-name" className="block">
          <Eyebrow>{NAME_STEP.label}</Eyebrow>
        </label>
        {nameState.status === 'locked' ? (
          <div className="mt-3 rounded-[16px] border border-[var(--gr-line-strong)] bg-[var(--gr-paper)] p-5">
            <div className="flex items-center gap-3 rounded-[11px] bg-[var(--gr-sand)] px-3.5 py-2.5">
              <span
                id="group-name"
                className="flex-1 text-[0.95rem] font-semibold text-[var(--app-ink)]"
              >
                {nameState.name}
              </span>
              <span
                className={`${MONO} inline-flex items-center gap-1.5 text-[0.6rem] uppercase tracking-[0.09em] text-[var(--app-muted)]`}
              >
                <LockIcon />
                locked
              </span>
            </div>
            <p className="mt-2.5 text-[0.74rem] leading-relaxed text-[var(--app-muted)]">
              {NAME_STEP.locked}
            </p>
          </div>
        ) : (
          <div className="mt-3 rounded-[16px] border border-[var(--gr-line-strong)] bg-[var(--gr-paper)] p-5">
            <p className="text-[0.76rem] leading-relaxed text-[var(--app-muted)]">{NAME_STEP.hint}</p>
            <input
              id="group-name"
              type="text"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setTried(false)
              }}
              maxLength={GROUP_NAME_MAX + 8}
              autoComplete="off"
              spellCheck={false}
              placeholder={NAME_STEP.placeholder}
              aria-invalid={showProblem}
              aria-describedby="group-name-note"
              disabled={nameState.status === 'loading'}
              className="mt-3 w-full rounded-[11px] border border-[var(--gr-line-strong)] bg-[var(--gr-sand)] px-3.5 py-2.5 text-[0.95rem] text-[var(--app-ink)] outline-none transition-colors placeholder:text-[var(--app-dim)] focus:border-[var(--gr-terra)] aria-[invalid=true]:border-[var(--gr-terra)]"
            />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className={`${MONO} text-[0.6rem] text-[var(--app-dim)]`}>suggestions ·</span>
              {NAME_STEP.suggestions.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setDraft(n)
                    setTried(false)
                  }}
                  className="rounded-full border border-[var(--gr-line-strong)] px-2.5 py-0.5 text-[0.7rem] text-[var(--app-muted)] transition-colors hover:border-[var(--gr-terra-edge)] hover:text-[var(--app-ink)]"
                >
                  {n}
                </button>
              ))}
            </div>
            <p
              id="group-name-note"
              role={showProblem || saveError ? 'alert' : undefined}
              className={`mt-3 text-[0.72rem] leading-relaxed ${
                showProblem || saveError ? 'text-[var(--gr-terra-ink)]' : 'text-[var(--app-dim)]'
              }`}
            >
              {showProblem ? problem : saveError ? SAVE_ERROR : NAME_STEP.lockNote}
            </p>
          </div>
        )}
      </div>

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
                    <Avatar look={myLook} size={56} />
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
          <button
            type="button"
            onClick={save}
            disabled={saving || nameState.status === 'loading'}
            className={PILL_SOLID}
          >
            {saving ? 'Saving…' : 'Save and continue'}
          </button>
        </div>
      </Panel>
    </div>
  )
}

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3" fill="none">
      <rect x="2.5" y="5.5" width="7" height="5" rx="1.2" fill="currentColor" />
      <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}
