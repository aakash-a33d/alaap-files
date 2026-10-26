import { useEffect, useRef, useState } from 'react'
import { BUILDER, GROUP } from '../../../content/groups'
import { useMyGroupName } from '../model/groupName'
import {
  AGE_BANDS,
  GENDERS,
  PORTRAITS,
  describe,
  portraitOf,
  type AvatarLook,
} from '../model/avatar'
import { saveMyLook, useMyLook } from '../model/myLook'
import { AvatarArt } from './Avatar'
import { ParticipantCircle } from './ParticipantCircle'
import { Eyebrow, MONO, PILL_QUIET, PILL_SOLID, SERIF, Title } from './parts'

/* ============================================================================
   1i — choosing an avatar.

   Twelve portraits laid out as a table: women on one row and men on the
   other, one column per age from child to elder. You find yourself, or who
   you would like to be met as, by reading along a row. There is nothing to
   build.

   The preview panel takes the colour of the chosen portrait's own backdrop,
   so the panel and the portrait in it read as one picture. The preview can
   also show the portrait in the circle at the size the group will actually
   see it, which is the size that decides whether a choice works.

   The choice is saved to the member's persona (the pseudonymous profile,
   never the account). The circle, the chat and the presence card all read it
   from there.
   ========================================================================= */

const SWATCH_ON = 'border-[1.5px] border-[var(--gr-terra)]'
const SWATCH_OFF = 'border border-[var(--gr-line-strong)] hover:border-[var(--gr-terra-edge)]'

export function AvatarBuilderView({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const saved = useMyLook()
  const myName = useMyGroupName(GROUP.id)
  const [look, setLook] = useState<AvatarLook>(saved)
  const [preview, setPreview] = useState(false)
  const [motion, setMotion] = useState('move')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  /* The saved choice can arrive after the window opens. Until the member
     picks something, follow it, so they start from what they chose last time
     rather than from the default. */
  const touched = useRef(false)
  useEffect(() => {
    if (!touched.current) setLook(saved)
  }, [saved])

  async function save() {
    setSaving(true)
    setError(false)
    try {
      await saveMyLook(look)
      onNext()
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  const chosen = portraitOf(look)

  return (
    <div className="mx-auto w-full max-w-[1000px] overflow-hidden rounded-[20px] shadow-[var(--gr-lift)] lg:grid lg:grid-cols-[340px_minmax(0,1fr)]">
      {/* ---- what the group sees ----------------------------------------- */}
      <div
        className="flex flex-col items-center gap-4 px-7 py-8 transition-[background] duration-500"
        style={{
          /* the portrait's own backdrop, lightened towards the page, so the
             panel continues the picture rather than framing it */
          background: `linear-gradient(170deg, color-mix(in oklab, ${chosen.seat} 55%, white) 0%, color-mix(in oklab, ${chosen.seat} 22%, var(--gr-sand)) 100%)`,
        }}
      >
        <Eyebrow>{preview ? 'your seat in the room' : 'how the group sees you'}</Eyebrow>
        {preview ? (
          <ParticipantCircle size={244} speaking={-1} labels={false} you={look} />
        ) : (
          <span
            className="block h-[208px] w-[208px] overflow-hidden rounded-full ring-4 ring-white/70 shadow-[0_14px_40px_rgb(26_24_20/0.22)]"
            style={{ background: chosen.seat }}
          >
            <AvatarArt look={look} label />
          </span>
        )}
        <div className="text-center">
          <p className={`${SERIF} text-[1.3rem] text-[var(--app-ink)]`}>{myName}</p>
          <p
            className={`${MONO} mt-1 text-[0.6rem] uppercase tracking-[0.09em] text-[var(--app-muted)]`}
          >
            {describe(chosen)}
          </p>
        </div>
        <button
          type="button"
          aria-pressed={preview}
          onClick={() => setPreview((p) => !p)}
          className="inline-flex min-h-9 items-center rounded-full bg-white/80 px-4 text-[0.74rem] text-[var(--app-ink)] transition-colors hover:bg-white"
        >
          {preview ? 'Back to the portrait' : 'Preview in circle'}
        </button>
        <p className="mt-auto pt-5 text-center text-[0.72rem] leading-relaxed text-[var(--app-ink)]/70">
          {BUILDER.carried}
        </p>
      </div>

      {/* ---- the twelve -------------------------------------------------- */}
      <div className="bg-[var(--app-ground)] px-5 py-7 sm:px-8">
        <Title>{BUILDER.title}</Title>
        <p className="mt-2 max-w-[52ch] text-[0.8rem] leading-relaxed text-[var(--app-faint)]">
          {BUILDER.blurb}
        </p>

        <div role="radiogroup" aria-label="Avatar" className="mt-6">
          {/* Age headings once, above both rows. On a phone the table folds
              to three columns and each tile carries its own age instead. */}
          <div className="hidden grid-cols-[64px_repeat(6,minmax(0,1fr))] gap-2 sm:grid">
            <span />
            {AGE_BANDS.map((a) => (
              <span
                key={a.id}
                className={`${MONO} text-center text-[0.58rem] uppercase leading-tight tracking-[0.08em] text-[var(--app-dim)]`}
              >
                {a.label}
              </span>
            ))}
          </div>

          {GENDERS.map((g) => (
            <div
              key={g.id}
              className="mt-3 grid grid-cols-3 items-center gap-x-2 gap-y-3 sm:grid-cols-[64px_repeat(6,minmax(0,1fr))]"
            >
              <span className="col-span-3 sm:col-span-1">
                <Eyebrow>{g.label}</Eyebrow>
              </span>
              {PORTRAITS.filter((p) => p.gender === g.id).map((p) => {
                const on = look.portrait === p.id
                const age = AGE_BANDS.find((a) => a.id === p.age)!.label
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={describe(p)}
                    title={describe(p)}
                    onClick={() => {
                      touched.current = true
                      setLook({ portrait: p.id })
                    }}
                    className="group flex flex-col items-center gap-1.5 rounded-[14px] py-1 focus-visible:outline-2 focus-visible:outline-[var(--gr-terra)]"
                  >
                    <span
                      className={`block aspect-square w-full max-w-[76px] overflow-hidden rounded-full transition-[transform,box-shadow] duration-200 ${
                        on ? 'scale-105' : 'group-hover:scale-[1.03]'
                      }`}
                      style={{
                        background: p.seat,
                        boxShadow: on
                          ? '0 0 0 2.5px var(--app-ground), 0 0 0 4.5px var(--gr-terra), 0 8px 18px rgb(26 24 20 / 0.18)'
                          : '0 2px 6px rgb(26 24 20 / 0.12)',
                      }}
                    >
                      <AvatarArt look={{ portrait: p.id }} />
                    </span>
                    <span
                      className={`${MONO} text-[0.56rem] uppercase tracking-[0.06em] sm:hidden ${
                        on ? 'text-[var(--gr-terra-ink)]' : 'text-[var(--app-dim)]'
                      }`}
                    >
                      {age}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
          <p className={`${MONO} mt-3 text-[0.6rem] text-[var(--app-dim)]`}>{BUILDER.pickNote}</p>
        </div>

        {/* Whether the portrait moves is a real accessibility choice, not a
            flourish, so it is offered here rather than assumed. */}
        <fieldset className="mt-6 border-0 p-0">
          <legend>
            <Eyebrow>what it does in session</Eyebrow>
          </legend>
          <div
            role="radiogroup"
            aria-label="What it does in session"
            className="mt-3 grid gap-2.5 sm:grid-cols-2"
          >
            {BUILDER.motion.map((m) => {
              const on = motion === m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setMotion(m.id)}
                  className={`rounded-[12px] bg-[var(--gr-paper)] p-4 text-left ${
                    on ? SWATCH_ON : SWATCH_OFF
                  }`}
                >
                  <span
                    className={`block text-[0.78rem] font-semibold ${
                      on ? 'text-[var(--app-ink)]' : 'text-[var(--app-muted)]'
                    }`}
                  >
                    {m.title}
                  </span>
                  <span className="mt-1 block text-[0.72rem] text-[var(--app-muted)]">
                    {m.body}
                  </span>
                </button>
              )
            })}
          </div>
        </fieldset>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2.5">
          <p
            role="status"
            className={`mr-auto text-[0.72rem] ${error ? 'text-[var(--gr-terra-ink)]' : 'text-[var(--app-dim)]'}`}
          >
            {error ? "Couldn't save just now. Your choice is still here, so try again." : BUILDER.saved}
          </p>
          <button type="button" onClick={onSkip} className={PILL_QUIET}>
            Skip for now
          </button>
          <button type="button" onClick={save} disabled={saving} className={PILL_SOLID}>
            {saving ? 'Saving…' : 'Use this avatar'}
          </button>
        </div>
      </div>
    </div>
  )
}
