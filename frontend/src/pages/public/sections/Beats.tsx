import { useRef } from 'react'
import { gsap, useGSAP } from '../../../utils/gsap'
import { BEATS, type Beat } from '../../../content/site'
import { Reveal } from '../../../components/ui/Reveal'

function BeatFigure({ beat }: { beat: Beat }) {
  const wrap = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const img = wrap.current?.querySelector('img')
      if (!img) return

      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          img,
          { yPercent: -5, scale: 1.1 },
          {
            yPercent: 5,
            scale: 1.1,
            ease: 'none',
            scrollTrigger: {
              trigger: wrap.current,
              start: 'top bottom',
              end: 'bottom top',
              scrub: true,
            },
          },
        )
      })
      return () => mm.revert()
    },
    { scope: wrap },
  )

  return (
    <div
      ref={wrap}
      className="grain relative aspect-4/3 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-sunken lg:aspect-3/4 xl:aspect-4/3"
    >
      <img
        src={beat.image}
        alt={beat.imageAlt}
        loading="lazy"
        decoding="async"
        width={1600}
        height={900}
        className="h-full w-full object-cover"
      />
      {/* bleed the still into the page so photo and canvas share one darkness */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(110%_80%_at_50%_50%,transparent_38%,rgb(11_9_8/0.55)_100%)]"
      />
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(180deg,transparent,rgb(11_9_8/0.9))]"
      />
    </div>
  )
}

function BeatBlock({ beat, index }: { beat: Beat; index: number }) {
  /* `side` names where the still sits, so a right-side still is the one that
     needs reordering. This previously read `=== 'left'`, which inverted every
     block relative to the data. */
  const flip = beat.side === 'right'

  return (
    <article
      id={index === 0 ? 'community' : undefined}
      className="u-shell grid items-center gap-[clamp(2.5rem,5vw,4.5rem)] py-[clamp(2.75rem,4.6vw,4.25rem)] lg:grid-cols-2"
    >
      <Reveal className={flip ? 'lg:order-2' : ''}>
        <BeatFigure beat={beat} />
      </Reveal>

      <Reveal className={flip ? 'lg:order-1' : ''} delay={0.08}>
        <p className="u-eyebrow">{beat.vault}</p>

        <h2 className="mt-5 text-[clamp(1.9rem,3.6vw,3rem)] text-ink">
          {beat.title}
        </h2>

        <p className="mt-3 font-[family-name:var(--font-mono)] text-[0.8125rem] text-accent">
          {beat.plan}
        </p>

        <p className="u-lede mt-6">{beat.body}</p>

        <dl className="mt-9 grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {beat.points.map((p) => (
            <div key={p.label} className="border-t border-[var(--border)] pt-4">
              <dt className="text-[0.9375rem] font-semibold text-ink">{p.label}</dt>
              <dd className="mt-1.5 text-[0.875rem] leading-relaxed text-muted">
                {p.detail}
              </dd>
            </div>
          ))}
        </dl>

        {beat.limit && (
          <p className="mt-8 flex gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[rgb(237_231_220/0.03)] p-4 text-[0.8125rem] leading-relaxed text-faint">
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              className="mt-0.5 shrink-0 text-accent"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" fill="none" />
              <path d="M8 4.6v4.2M8 11.1v.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span>
              <span className="text-muted">The honest limit — </span>
              {beat.limit}
            </span>
          </p>
        )}
      </Reveal>
    </article>
  )
}

export function Beats() {
  return (
    <section
      aria-label="What Alaap offers"
      className="theme-light bg-surface relative border-t border-[var(--border)]"
    >
      {BEATS.map((beat, i) => (
        <div key={beat.id} id={beat.id}>
          {i > 0 && (
            <div className="u-shell">
              <div className="rule-seam" />
            </div>
          )}
          <BeatBlock beat={beat} index={i} />
        </div>
      ))}
    </section>
  )
}
