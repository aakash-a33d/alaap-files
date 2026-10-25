import { useEffect, useRef, useState } from 'react'
import { BUILDER } from '../../../content/groups'
import {
  BACKDROPS,
  COVERED,
  HAIR_SHADES,
  HAIR_STYLES,
  OUTFITS,
  SKIN_TONES,
  type AvatarLook,
  type FacialHair,
} from '../model/avatar'
import { saveMyLook, useMyLook } from '../model/myLook'
import { Avatar } from './Avatar'
import { ParticipantCircle } from './ParticipantCircle'
import {
  Eyebrow,
  MONO,
  PILL_QUIET,
  PILL_SOLID,
  SERIF,
  Title,
} from './parts'

/* ============================================================================
   1i — the avatar builder.

   Three choices that matter — hair, skin, outfit — and a few small ones under
   them. A builder with twenty sliders would take twenty minutes and produce
   something the member then feels obliged to defend; this takes under a
   minute and produces a stand-in.

   Every hair and outfit tile shows the member's own portrait with exactly one
   part swapped, never a generic model, so what a tile is offering is
   unmistakable. The preview is the same drawing at the size it appears in the
   circle, so nobody is surprised by their own avatar in the first session.

   The look is saved to the member's persona — the pseudonymous profile, never
   the account — and the circle, the chat and the presence card all read it
   from there.
   ========================================================================= */

const SWATCH_ON = 'border-[1.5px] border-[var(--gr-terra)]'
const SWATCH_OFF = 'border border-[var(--gr-line-strong)] hover:border-[var(--gr-terra-edge)]'
const DOT_ON = '0 0 0 2px var(--app-ground), 0 0 0 3.5px var(--gr-terra)'
const CHIP = 'inline-flex min-h-8 items-center rounded-full px-3.5 text-[0.72rem] transition-colors'
const CHIP_ON = 'bg-[var(--app-ink)] text-[var(--app-ground)]'
const CHIP_OFF =
  'bg-[var(--gr-paper)] text-[var(--app-muted)] border border-[var(--gr-line-strong)] hover:border-[var(--gr-terra-edge)]'

const FACIAL: { id: FacialHair; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'stubble', label: 'Stubble' },
  { id: 'beard', label: 'Beard' },
]

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]

export function AvatarBuilderView({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const saved = useMyLook()
  const [look, setLook] = useState<AvatarLook>(saved)
  const [preview, setPreview] = useState(false)
  const [motion, setMotion] = useState('move')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  /* The saved look can arrive after the builder opens. Until the member
     touches something, follow it, so they start from what they chose last
     time rather than from the default. */
  const touched = useRef(false)
  useEffect(() => {
    if (!touched.current) setLook(saved)
  }, [saved])

  const set = (part: Partial<AvatarLook>) => {
    touched.current = true
    setLook((l) => ({ ...l, ...part }))
  }

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

  const covered = COVERED.has(look.hair)

  return (
    <div className="mx-auto w-full max-w-[1000px] overflow-hidden rounded-[20px] shadow-[var(--gr-lift)] lg:grid lg:grid-cols-[340px_minmax(0,1fr)]">
      {/* ---- what the group sees ----------------------------------------- */}
      <div className="flex flex-col items-center gap-4 bg-[var(--gr-sand)] px-7 py-8">
        <Eyebrow>{preview ? 'your seat in the room' : 'how the group sees you'}</Eyebrow>
        {/* Two sizes of the same answer: the drawing at the size you judge it
            by, and the drawing at the size it is actually seen at, in the
            circle it is actually seen in. The second is the one that decides
            whether a choice was any good. */}
        {preview ? (
          <ParticipantCircle size={244} speaking={-1} labels={false} you={look} />
        ) : (
          <span className="rounded-full shadow-[0_8px_30px_rgb(26_24_20/0.12)]">
            <Avatar look={look} size={196} />
          </span>
        )}
        <div className="text-center">
          <p className={`${SERIF} text-[1.3rem] text-[var(--app-ink)]`}>Wren</p>
          <p
            className={`${MONO} mt-1 text-[0.6rem] uppercase tracking-[0.09em] text-[var(--gr-green)]`}
          >
            anonymous · voice only
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            aria-pressed={preview}
            onClick={() => setPreview((p) => !p)}
            className="inline-flex min-h-9 items-center rounded-full bg-[var(--gr-paper)] px-4 text-[0.74rem] text-[var(--app-ink)] transition-colors hover:bg-white"
          >
            {preview ? 'Back to the avatar' : 'Preview in circle'}
          </button>
          <button
            type="button"
            onClick={() =>
              set({
                hair: pick(HAIR_STYLES).id,
                hairShade: pick(HAIR_SHADES).id,
                skin: pick(SKIN_TONES).id,
                outfit: pick(OUTFITS).id,
                backdrop: pick(BACKDROPS).id,
              })
            }
            className="inline-flex min-h-9 items-center rounded-full bg-[var(--gr-paper)] px-4 text-[0.74rem] text-[var(--app-ink)] transition-colors hover:bg-white"
          >
            Shuffle
          </button>
        </div>
        <p className="mt-auto pt-5 text-center text-[0.72rem] leading-relaxed text-[var(--app-muted)]">
          {BUILDER.carried}
        </p>
      </div>

      {/* ---- the choices -------------------------------------------------- */}
      <div className="bg-[var(--app-ground)] px-6 py-7 sm:px-8">
        <Title>{BUILDER.title}</Title>
        <p className="mt-2 max-w-[52ch] text-[0.8rem] leading-relaxed text-[var(--app-faint)]">
          {BUILDER.blurb}
        </p>

        <fieldset className="mt-6 border-0 p-0">
          <legend>
            <Eyebrow>hairstyle</Eyebrow>
          </legend>
          <div role="radiogroup" aria-label="Hairstyle" className="mt-2.5 flex flex-wrap gap-2.5">
            {HAIR_STYLES.map((h) => (
              <button
                key={h.id}
                type="button"
                role="radio"
                aria-checked={look.hair === h.id}
                aria-label={h.label}
                title={h.label}
                onClick={() => set({ hair: h.id })}
                className={`rounded-[15px] p-0.5 ${look.hair === h.id ? SWATCH_ON : SWATCH_OFF}`}
              >
                <Avatar look={{ ...look, hair: h.id }} size={56} shape="squircle" />
              </button>
            ))}
          </div>
          <p className={`${MONO} mt-2 text-[0.6rem] text-[var(--app-dim)]`}>{BUILDER.hairNote}</p>

          <div
            role="radiogroup"
            aria-label={covered ? 'Brow and beard colour' : 'Hair colour'}
            className="mt-3 flex flex-wrap items-center gap-2"
          >
            <span className="mr-1 text-[0.7rem] text-[var(--app-dim)]">
              {covered ? 'brows' : 'colour'}
            </span>
            {HAIR_SHADES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={look.hairShade === s.id}
                aria-label={s.label}
                title={s.label}
                onClick={() => set({ hairShade: s.id })}
                className="h-[26px] w-[26px] rounded-full"
                style={{
                  background: `oklch(${s.lch[0]} ${s.lch[1]} ${s.lch[2]})`,
                  boxShadow: look.hairShade === s.id ? DOT_ON : undefined,
                }}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-5 border-0 p-0">
          <legend>
            <Eyebrow>skin colour</Eyebrow>
          </legend>
          <div role="radiogroup" aria-label="Skin colour" className="mt-2.5 flex flex-wrap gap-2">
            {SKIN_TONES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={look.skin === t.id}
                aria-label={t.label}
                title={t.label}
                onClick={() => set({ skin: t.id })}
                className="h-[30px] w-[30px] rounded-full"
                style={{
                  background: `radial-gradient(circle at 38% 34%, oklch(${t.lch[0] + 0.06} ${t.lch[1]} ${t.lch[2]}), oklch(${t.lch[0]} ${t.lch[1]} ${t.lch[2]}) 55%, oklch(${t.lch[0] - 0.08} ${t.lch[1]} ${t.lch[2]}))`,
                  boxShadow: look.skin === t.id ? DOT_ON : undefined,
                }}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-5 border-0 p-0">
          <legend>
            <Eyebrow>outfit</Eyebrow>
          </legend>
          <div role="radiogroup" aria-label="Outfit" className="mt-2.5 flex flex-wrap gap-2.5">
            {OUTFITS.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={look.outfit === o.id}
                aria-label={o.label}
                title={o.label}
                onClick={() => set({ outfit: o.id })}
                className={`rounded-[15px] p-0.5 ${look.outfit === o.id ? SWATCH_ON : SWATCH_OFF}`}
              >
                <Avatar look={{ ...look, outfit: o.id }} size={56} shape="squircle" />
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <fieldset className="border-0 p-0">
            <legend>
              <Eyebrow>backdrop</Eyebrow>
            </legend>
            <div role="radiogroup" aria-label="Backdrop" className="mt-2.5 flex flex-wrap gap-2">
              {BACKDROPS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={look.backdrop === b.id}
                  aria-label={b.label}
                  title={b.label}
                  onClick={() => set({ backdrop: b.id })}
                  className="h-[30px] w-[30px] rounded-full"
                  style={{
                    background: `linear-gradient(135deg, ${b.from}, ${b.to})`,
                    boxShadow: look.backdrop === b.id ? DOT_ON : undefined,
                  }}
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="border-0 p-0">
            <legend>
              <Eyebrow>facial hair</Eyebrow>
            </legend>
            <div role="radiogroup" aria-label="Facial hair" className="mt-2.5 flex flex-wrap gap-1.5">
              {FACIAL.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={look.facialHair === f.id}
                  onClick={() => set({ facialHair: f.id })}
                  className={`${CHIP} ${look.facialHair === f.id ? CHIP_ON : CHIP_OFF}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <fieldset className="mt-5 border-0 p-0">
          <legend>
            <Eyebrow>extras</Eyebrow>
          </legend>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {(
              [
                ['glasses', 'Glasses'],
                ['bindi', 'Bindi'],
                ['earrings', 'Earrings'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={look[k]}
                onClick={() => set({ [k]: !look[k] })}
                className={`${CHIP} ${look[k] ? CHIP_ON : CHIP_OFF}`}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Whether the drawing moves is a real accessibility choice, not a
            flourish, so it is offered here rather than assumed. */}
        <fieldset className="mt-5 border-0 p-0">
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
            {error ? "Couldn't save just now. Your choices are still here — try again." : BUILDER.saved}
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
