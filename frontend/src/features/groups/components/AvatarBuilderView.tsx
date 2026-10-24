import { useState } from 'react'
import { BUILDER } from '../../../content/groups'
import {
  CIRCLE_COLOURS,
  HAIR_STYLES,
  SKIN_TONES,
  type Face,
  type FaceKey,
  type HairStyle,
} from '../model/avatar'
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

   Four choices and no more: the character, the hair, the skin, the colour of
   the circle you sit in. A builder with twenty sliders would take twenty
   minutes and produce something the member then feels obliged to defend; four
   choices take under a minute and produce a stand-in.

   Every tile shows the member's own character with exactly one part swapped,
   never a generic model, so what a tile is offering is unmistakable. The
   preview is the same drawing at the size it appears in the circle, so nobody
   is surprised by their own avatar in the first session.
   ========================================================================= */

const BASE_FACES: FaceKey[] = ['wren', 'pip', 'marlow', 'sable', 'corvo', 'juniper']

const SWATCH_ON = 'border-[1.5px] border-[var(--gr-terra)]'
const SWATCH_OFF = 'border border-[var(--gr-line-strong)] hover:border-[var(--gr-terra-edge)]'

export function AvatarBuilderView({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [face, setFace] = useState<FaceKey>('wren')
  const [hair, setHair] = useState<HairStyle>('long')
  const [skin, setSkin] = useState(1)
  const [colour, setColour] = useState(0)
  const [motion, setMotion] = useState('move')
  const [preview, setPreview] = useState(false)

  /* The four choices, collapsed into the one override every tile and the
     preview are drawn from. */
  const tweak: Partial<Face> = {
    style: hair,
    skin: SKIN_TONES[skin].skin,
    skinShade: SKIN_TONES[skin].skinShade,
    top: CIRCLE_COLOURS[colour].top,
    bg: CIRCLE_COLOURS[colour].bg,
  }

  return (
    <div className="mx-auto w-full max-w-[960px] overflow-hidden rounded-[20px] shadow-[var(--gr-lift)] lg:grid lg:grid-cols-[340px_minmax(0,1fr)]">
      {/* ---- what the group sees ----------------------------------------- */}
      <div className="flex flex-col items-center gap-4 bg-[var(--gr-sand)] px-7 py-8">
        <Eyebrow>{preview ? 'your seat in the room' : 'how the group sees you'}</Eyebrow>
        {/* Two sizes of the same answer: the drawing at the size you judge it
            by, and the drawing at the size it is actually seen at, in the
            circle it is actually seen in. The second is the one that decides
            whether a choice was any good. */}
        {preview ? (
          <ParticipantCircle size={244} speaking={-1} labels={false} you={tweak} />
        ) : (
          <span className="rounded-full shadow-[0_8px_30px_rgb(26_24_20/0.12)]">
            <Avatar face={face} tweak={tweak} size={196} />
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
            onClick={() => {
              setFace(BASE_FACES[Math.floor(Math.random() * BASE_FACES.length)])
              setHair(HAIR_STYLES[Math.floor(Math.random() * HAIR_STYLES.length)])
              setSkin(Math.floor(Math.random() * SKIN_TONES.length))
              setColour(Math.floor(Math.random() * CIRCLE_COLOURS.length))
            }}
            className="inline-flex min-h-9 items-center rounded-full bg-[var(--gr-paper)] px-4 text-[0.74rem] text-[var(--app-ink)] transition-colors hover:bg-white"
          >
            Shuffle
          </button>
        </div>
        <p className="mt-auto pt-5 text-center text-[0.72rem] leading-relaxed text-[var(--app-muted)]">
          {BUILDER.carried}
        </p>
      </div>

      {/* ---- the four choices -------------------------------------------- */}
      <div className="bg-[var(--app-ground)] px-6 py-7 sm:px-8">
        <Title>{BUILDER.title}</Title>
        <p className="mt-2 max-w-[52ch] text-[0.8rem] leading-relaxed text-[var(--app-faint)]">
          {BUILDER.blurb}
        </p>

        <fieldset className="mt-6 border-0 p-0">
          <div className="flex items-baseline justify-between gap-2">
            <legend className="float-left">
              <Eyebrow>face</Eyebrow>
            </legend>
            <span className="ml-auto text-[0.7rem] text-[var(--app-dim)]">
              {BASE_FACES.indexOf(face) + 1} of {BASE_FACES.length}
            </span>
          </div>
          <div
            role="radiogroup"
            aria-label="Face"
            className="mt-2.5 flex flex-wrap items-center gap-2.5"
          >
            {BASE_FACES.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={face === k}
                aria-label={`Face ${k}`}
                onClick={() => setFace(k)}
                className={`rounded-[15px] p-0.5 ${face === k ? SWATCH_ON : SWATCH_OFF}`}
              >
                <Avatar face={k} tweak={{ style: hair }} size={52} shape="squircle" />
              </button>
            ))}
          </div>
          <p className={`${MONO} mt-2 text-[0.6rem] text-[var(--app-dim)]`}>{BUILDER.faceNote}</p>
        </fieldset>

        <fieldset className="mt-5 border-0 p-0">
          <legend>
            <Eyebrow>hair</Eyebrow>
          </legend>
          <div
            role="radiogroup"
            aria-label="Hair"
            className="mt-2.5 flex flex-wrap items-center gap-2.5"
          >
            {HAIR_STYLES.map((h) => (
              <button
                key={h}
                type="button"
                role="radio"
                aria-checked={hair === h}
                aria-label={`Hair ${h}`}
                onClick={() => setHair(h)}
                className={`rounded-[15px] p-0.5 ${hair === h ? SWATCH_ON : SWATCH_OFF}`}
              >
                <Avatar face={face} tweak={{ ...tweak, style: h }} size={52} shape="squircle" />
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <fieldset className="border-0 p-0">
            <legend>
              <Eyebrow>skin</Eyebrow>
            </legend>
            <div role="radiogroup" aria-label="Skin" className="mt-2.5 flex flex-wrap gap-2">
              {SKIN_TONES.map((t, i) => (
                <button
                  key={t.skin}
                  type="button"
                  role="radio"
                  aria-checked={skin === i}
                  aria-label={`Skin tone ${i + 1}`}
                  onClick={() => setSkin(i)}
                  className="h-[30px] w-[30px] rounded-full"
                  style={{
                    background: t.skin,
                    boxShadow:
                      skin === i
                        ? '0 0 0 2px var(--app-ground), 0 0 0 3.5px var(--gr-terra)'
                        : undefined,
                  }}
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="border-0 p-0">
            <legend>
              <Eyebrow>circle colour</Eyebrow>
            </legend>
            <div
              role="radiogroup"
              aria-label="Circle colour"
              className="mt-2.5 flex flex-wrap gap-2"
            >
              {CIRCLE_COLOURS.map((c, i) => (
                <button
                  key={c.top}
                  type="button"
                  role="radio"
                  aria-checked={colour === i}
                  aria-label={`Circle colour ${i + 1}`}
                  onClick={() => setColour(i)}
                  className="h-[30px] w-[30px] rounded-full"
                  style={{
                    background: c.top,
                    boxShadow:
                      colour === i
                        ? '0 0 0 2px var(--app-ground), 0 0 0 3.5px var(--gr-terra)'
                        : undefined,
                  }}
                />
              ))}
            </div>
          </fieldset>
        </div>

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

        <div className="mt-6 flex flex-wrap justify-end gap-2.5">
          <button type="button" onClick={onSkip} className={PILL_QUIET}>
            Skip for now
          </button>
          <button type="button" onClick={onNext} className={PILL_SOLID}>
            Use this avatar
          </button>
        </div>
      </div>
    </div>
  )
}
