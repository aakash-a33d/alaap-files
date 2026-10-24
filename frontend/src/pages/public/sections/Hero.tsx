import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { gsap, useGSAP } from '../../../utils/gsap'
import { HERO, HERO_TILES, SCENES } from '../../../content/site'
import { useIsSmall } from '../../../hooks/media'

/* Viewport heights of scroll the pinned hero consumes.
   Raised from 7.5: the dust->thread disintegration and the scene-3->scene-4
   travel were both scrubbing far faster than every other beat (up to
   12s of film per vh scrolled, vs. 4-6s/vh elsewhere) because they carried
   the same scroll budget as much shorter transitions. The extra 1.6vh goes
   entirely to those two stretches below — nothing else changed length. */
const SCROLL_LENGTH = 9.1

const [S1, S2, S3, S4] = SCENES

/* Beats between the key scenes. None carries copy, but each is a shot that
   makes the metaphor legible, and at an even scrub rate they flash past in a
   few dozen pixels of scroll. */
const T_DUST = 13.2 // the stones have become a column of dust
const T_THREAD = 16.5 // the dust has drawn itself into a single gold thread
const T_HANDS = 19.0 // the thread enters a stone held in cupped hands
const T_PASS = 23.5 // the thread runs on, stone to stone, hand to hand

/**
 * Scroll progress -> time in the film, as a piecewise ramp.
 * Flat runs are *dwells*: the picture holds still while copy is read.
 * Sloped runs are transitions, and their gradient sets the playback rate —
 * a shallower run means that stretch of film gets more scroll to play out in.
 */
const TIMELINE: [number, number][] = [
  [0.0, S1.time],
  [0.0495, S1.time], // opening hold
  [0.1236, S2.time], // travel
  [0.1978, S2.time], // dwell — scene 2
  [0.294, T_DUST], // slow: the stones break apart into dust (widened +0.35vh)
  [0.3269, T_DUST], // brief hold on the dust column
  [0.4121, T_THREAD], // slow: the dust draws itself into the gold thread (widened +0.25vh)
  [0.4615, T_HANDS], // the thread reaches the first pair of hands
  [0.4945, T_HANDS], // brief hold as it enters the stone
  [0.5769, T_PASS], // slow: the thread passes hand to hand, stone to stone
  [0.6264, S3.time], // travel out to the circle
  [0.7005, S3.time], // dwell — scene 3
  [0.9011, S4.time], // travel (widened +1.0vh — was the fastest beat in the film)
  [1.0, S4.time], // dwell — scene 4
]

function videoTimeAt(p: number): number {
  for (let i = 1; i < TIMELINE.length; i++) {
    const [p0, t0] = TIMELINE[i - 1]
    const [p1, t1] = TIMELINE[i]
    if (p <= p1) {
      const k = p1 === p0 ? 0 : (p - p0) / (p1 - p0)
      return t0 + (t1 - t0) * k
    }
  }
  return S4.time
}

/* Fade windows per scene: [fadeInFrom, fullFrom, fullTo, fadeOutTo].
   The final window's fade-out sits past 1 on purpose — ending it exactly at 1
   makes the last scene vanish at the bottom of the pin, which dropped both the
   closing still and its copy. */
const STILL_WINDOWS: [number, number, number, number][] = [
  /* Starts below zero so the opening frame is already the crisp still at
     p = 0 — the envelope returns 0 when p equals the window's start. */
  [-0.05, 0.0, 0.05, 0.09],
  [0.0836, 0.1236, 0.1978, 0.2378],
  [0.5864, 0.6264, 0.7005, 0.7405],
  [0.8611, 0.9011, 1.2, 1.2],
]

const TEXT_WINDOWS: [number, number, number, number][] = [
  [0, 0, 0, 0], // scene 1 has no feature copy
  [0.1236, 0.1536, 0.1928, 0.2278],
  [0.6264, 0.6564, 0.6955, 0.7305],
  [0.9011, 0.9311, 1.2, 1.2],
]

function envelope(p: number, w: [number, number, number, number]): number {
  const [a, b, c, d] = w
  if (p <= a || p >= d) return 0
  if (p < b) return (p - a) / (b - a)
  if (p <= c) return 1
  return 1 - (p - c) / (d - c)
}

const ANCHOR_CLASS: Record<string, string> = {
  centre: 'items-center justify-center text-center',
  /* Scenes 2 and 4 are composed hard right, so the copy takes the empty left. */
  left: 'items-start justify-center text-left',
  /* Scene 3 fills the middle band; the only clear space is above their heads. */
  top: 'items-center justify-start pt-[16vh] text-center',
}

function TileIcon({ name }: { name: string }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      {name === 'pulse' && <path d="M2 12h4l3-8 4 16 3-8h6" {...common} />}
      {name === 'moon' && <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" {...common} />}
      {name === 'home' && <path d="M4 11l8-6 8 6v8a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z" {...common} />}
      {name === 'leaf' && <path d="M4 20c0-8 5-13 16-14 0 11-5 15-11 15a5 5 0 01-5-1zm4-2c3-4 6-6 9-7" {...common} />}
    </svg>
  )
}

export function Hero() {
  const root = useRef<HTMLElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const openRef = useRef<HTMLDivElement>(null)
  const stillRefs = useRef<(HTMLImageElement | null)[]>([])
  const textRefs = useRef<(HTMLDivElement | null)[]>([])
  const cueRef = useRef<HTMLDivElement>(null)
  const isSmall = useIsSmall()

  useGSAP(
    () => {
      const video = videoRef.current
      const section = root.current
      if (!video || !section) return

      const mm = gsap.matchMedia()

      mm.add(
        {
          motion: '(prefers-reduced-motion: no-preference)',
          reduced: '(prefers-reduced-motion: reduce)',
        },
        (ctx) => {
          const { reduced } = ctx.conditions as { reduced: boolean }

          if (reduced) {
            /* Static: opening copy plus every feature block, no pin. */
            gsap.set(openRef.current, { opacity: 1 })
            stillRefs.current.forEach((el, i) => gsap.set(el, { opacity: i === 0 ? 1 : 0 }))
            textRefs.current.forEach((el) => gsap.set(el, { opacity: 1 }))
            return
          }

          let target = 0
          let seeking = false

          const applySeek = () => {
            if (seeking || video.readyState < 2) return
            if (Math.abs(video.currentTime - target) < 0.02) return
            seeking = true
            video.currentTime = target
          }
          const onSeeked = () => {
            seeking = false
          }
          video.addEventListener('seeked', onSeeked)
          gsap.ticker.add(applySeek)

          const state = { p: 0 }

          /* All opacities are derived from one number, every frame. Keeping the
             whole hero a pure function of scroll progress is far easier to
             reason about than a dozen overlapping tweens. */
          const paint = () => {
            const p = state.p
            target = videoTimeAt(p)

            /* The opening block clears out almost immediately once scrolling
               begins, rather than lingering across the whole transition. */
            const open = 1 - envelopeIn(p, 0.005, 0.05)
            if (openRef.current) {
              openRef.current.style.opacity = String(open)
              openRef.current.style.transform = `translate3d(0,${(1 - open) * -34}px,0)`
              openRef.current.style.pointerEvents = open < 0.4 ? 'none' : 'auto'
            }

            stillRefs.current.forEach((el, i) => {
              if (el) el.style.opacity = String(envelope(p, STILL_WINDOWS[i]))
            })

            textRefs.current.forEach((el, i) => {
              if (!el) return
              const o = envelope(p, TEXT_WINDOWS[i])
              el.style.opacity = String(o)
              el.style.transform = `translate3d(0,${(1 - o) * 22}px,0)`
              el.style.pointerEvents = o > 0.6 ? 'auto' : 'none'
            })

            if (cueRef.current) {
              cueRef.current.style.opacity = String(1 - envelopeIn(p, 0.005, 0.04))
            }
          }

          gsap.to(state, {
            p: 1,
            ease: 'none',
            scrollTrigger: {
              trigger: section,
              start: 'top top',
              end: `+=${window.innerHeight * SCROLL_LENGTH}`,
              pin: true,
              scrub: 0.55,
              anticipatePin: 1,
              invalidateOnRefresh: true,
            },
            onUpdate: paint,
          })

          paint()

          return () => {
            gsap.ticker.remove(applySeek)
            video.removeEventListener('seeked', onSeeked)
          }
        },
      )

      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <section
      ref={root}
      id="top"
      className="theme-dark relative isolate h-svh w-full overflow-hidden bg-[var(--ink-950)]"
    >
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        src={isSmall ? '/media/kintsugi-960.mp4' : '/media/kintsugi-1600.mp4'}
        poster="/media/hero-poster.jpg"
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* High-resolution stills crossfade over the film during each dwell. */}
      {SCENES.map((s, i) => (
        <img
          key={s.id}
          ref={(el) => {
            stillRefs.current[i] = el
          }}
          src={isSmall ? s.stillSmall : s.still}
          alt={i === 0 ? s.alt : ''}
          aria-hidden={i === 0 ? undefined : true}
          fetchPriority={i === 0 ? 'high' : 'low'}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity: i === 0 ? 1 : 0 }}
        />
      ))}

      {/* Light at the top so the bar reads as part of the picture, heavier at
          the foot where the copy sits. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(180deg,rgb(6_5_5/0.42)_0%,rgb(6_5_5/0.10)_14%,rgb(6_5_5/0.20)_52%,rgb(6_5_5/0.72)_86%,rgb(6_5_5/0.94)_100%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(64%_56%_at_50%_46%,rgb(6_5_5/0.44)_0%,transparent_74%)]"
      />

      {/* ------------------------------------------------- opening block --- */}
      <div
        ref={openRef}
        className="absolute inset-0 z-10 flex flex-col items-start justify-center px-[var(--spacing-gutter)] pt-20 text-left"
      >
        <div className="w-full max-w-[34rem] lg:ml-[4vw]">
          {/* The badge sits above rather than inline: at this column width an
              inline pill would push the headline line past the measure. */}
          {/* Explicit size: the class sizes itself in `em` for use inside a
              headline, which collapses to the floor once it stands alone. */}
          <span className="headline-pill mb-6 inline-flex text-[0.78rem]">
            <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 3l1.9 4.9L19 9.5l-4.1 2.2L13 17l-2-4.9L6 9.9l4.2-1.7z"
                fill="currentColor"
              />
            </svg>
            {HERO.pill}
          </span>

          {/* Weight 400 rather than 500 — lighter strokes so a headline this
              large sits over the film without shouting. */}
          <h1 className="font-[family-name:var(--font-display)] text-[clamp(2.2rem,5vw,4.4rem)] font-normal leading-[1.0] tracking-[-0.035em] text-ink">
            {HERO.lines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </h1>

          <p className="mt-6 text-[0.85rem] leading-relaxed text-muted">
            {HERO.note}
          </p>
        </div>
      </div>

      {/* -------------------------------------------------- scene copy ----- */}
      {SCENES.map((s, i) =>
        s.line ? (
          <div
            key={s.id}
            ref={(el) => {
              textRefs.current[i] = el
            }}
            className={[
              'absolute inset-0 z-10 flex flex-col px-[var(--spacing-gutter)] py-24',
              ANCHOR_CLASS[s.anchor],
            ].join(' ')}
            style={{ opacity: 0 }}
          >
            <div
              className={[
                'w-full',
                s.anchor === 'left'
                  ? 'max-w-[34rem] lg:ml-[4vw]'
                  : 'mx-auto max-w-2xl',
              ].join(' ')}
            >
              {s.kicker && <p className="u-eyebrow mb-4">{s.kicker}</p>}

              <p className="font-[family-name:var(--font-display)] text-[clamp(1.7rem,3.6vw,2.9rem)] font-medium leading-[1.04] tracking-[-0.035em] text-ink">
                {s.line}
              </p>

              {s.body && (
                <p
                  className={[
                    'mt-4 text-[clamp(0.9rem,1.1vw,1rem)] leading-relaxed text-muted',
                    s.anchor === 'centre' || s.anchor === 'top' ? 'mx-auto' : '',
                  ].join(' ')}
                >
                  {s.body}
                </p>
              )}

              {s.tags && (
                <ul className="mt-6 flex flex-wrap gap-2">
                  {s.tags.map((t) => (
                    <li key={t} className="chip chip--accent">
                      {t}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null,
      )}

      {/* ------------------------------------------------ floating layer --- */}
      <div
        ref={cueRef}
        className="absolute inset-x-0 bottom-0 z-10 mx-auto hidden w-full max-w-[var(--shell-max)] items-end justify-end px-[var(--spacing-gutter)] pb-8 lg:flex"
      >
        {/* One link, not a composer.

            The bottom row looked like a text field and was a <span>: clicking it
            did nothing, typing into it did nothing, and the four topics above were
            <button>s that did nothing either. A control shaped like an input that
            cannot be typed into is the first promise this page breaks.

            The whole card is now a single link to the real thing. The tiles are
            spans — they illustrate the kinds of topic rather than offering to
            filter anything, and nesting buttons inside a link would be invalid
            besides. */}
        <Link
          to="/join"
          className="glass block w-[21rem] p-4 no-underline transition-colors hover:border-[var(--border-seam)]"
        >
          <p className="mb-3 text-center text-[0.9rem] font-semibold text-ink">
            What is on your mind?
          </p>

          <div className="grid grid-cols-2 gap-2">
            {HERO_TILES.map((t) => (
              <span
                key={t.id}
                className="glass-tile flex flex-col items-center gap-1.5 py-3 text-ink"
              >
                <TileIcon name={t.icon} />
                <span className="text-[0.78rem]">{t.label}</span>
              </span>
            ))}
          </div>

          <span className="mt-2.5 flex items-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(237_231_220/0.12)] bg-[rgb(237_231_220/0.07)] px-3 py-2.5">
            <span
              aria-hidden="true"
              className="h-5 w-5 flex-none rounded-full bg-[radial-gradient(circle_at_30%_30%,var(--gold-300),var(--gold-700))]"
            />
            <span className="flex-1 text-[0.82rem] text-muted">Write it anonymously</span>
            <svg width="13" height="11" viewBox="0 0 15 12" aria-hidden="true" className="flex-none">
              <path
                d="M1 6h12M9 2l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.7"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </Link>
      </div>
    </section>
  )
}

/** Ramp from 0 to 1 across [a, b]. */
function envelopeIn(p: number, a: number, b: number): number {
  if (p <= a) return 0
  if (p >= b) return 1
  return (p - a) / (b - a)
}
