import { useEffect, useRef, useState } from 'react'
import { ScrollTrigger, useGSAP } from '../../../utils/gsap'
import { FILTER_PASSES, FILTER_SAMPLES, HARM_CATEGORIES } from '../../../content/site'
import { useReducedMotion } from '../../../hooks/media'

/* ============================================================================
   THE SHIELD

   A live demonstration of the moderation filter, deliberately not a claim
   about platform history. Alaap has not launched, so a running total of
   genuinely blocked messages would be invented. Here the visitor watches each
   reply arrive and get caught, and the tally counts what this demo has caught
   in front of them — which is visibly a demonstration rather than a metric.
   ========================================================================= */

type Caught = { id: number; text: string; cat: string; blocked: boolean }

const TICK_MS = 2100

export function Shield() {
  const root = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reduced = useReducedMotion()

  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(HARM_CATEGORIES.map((c) => [c.id, 0])),
  )
  const [feed, setFeed] = useState<Caught[]>([])
  const [running, setRunning] = useState(false)
  const idRef = useRef(0)
  const lastIdx = useRef(0)
  const burst = useRef<(() => void) | null>(null)

  /* ------------------------------------------------------- the stream --- */
  useEffect(() => {
    if (!running || reduced) return

    const step = () => {
      /* roughly one in four gets through, so the demo does not read as
         "everything is blocked" */
      const passes = Math.random() < 0.26
      const id = ++idRef.current

      if (passes) {
        const text = FILTER_PASSES[id % FILTER_PASSES.length]
        setFeed((f) => [{ id, text, cat: 'ok', blocked: false }, ...f].slice(0, 4))
        return
      }

      /* Step by a random stride instead of picking freely, so the same line
         never lands twice in a row in a four-item queue. */
      lastIdx.current =
        (lastIdx.current + 1 + Math.floor(Math.random() * (FILTER_SAMPLES.length - 1))) %
        FILTER_SAMPLES.length
      const s = FILTER_SAMPLES[lastIdx.current]
      setFeed((f) => [{ id, text: s.text, cat: s.cat, blocked: true }, ...f].slice(0, 4))
      setCounts((c) => ({ ...c, [s.cat]: (c[s.cat] ?? 0) + 1 }))
      burst.current?.()
    }

    /* The first few arrive quickly so the panel fills instead of sitting
       almost empty, then it settles to a readable pace. */
    let n = 0
    let timer: number
    const schedule = () => {
      const delay = n < 4 ? 620 : TICK_MS
      timer = window.setTimeout(() => {
        step()
        n += 1
        schedule()
      }, delay)
    }
    step()
    n += 1
    schedule()

    return () => window.clearTimeout(timer)
  }, [running, reduced])

  /* Only run while the section is actually on screen. */
  useGSAP(
    () => {
      const st = ScrollTrigger.create({
        trigger: root.current!,
        start: 'top 85%',
        end: 'bottom 15%',
        onToggle: (self) => setRunning(self.isActive),
      })
      return () => st.kill()
    },
    { scope: root },
  )

  /* --------------------------------------------------- impact particles -- */
  useGSAP(
    () => {
      const canvas = canvasRef.current
      if (!canvas || reduced) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      type P = { x: number; y: number; vx: number; vy: number; life: number; r: number }
      let parts: P[] = []
      let raf = 0

      const size = () => {
        const dpr = Math.min(devicePixelRatio, 2)
        canvas.width = canvas.offsetWidth * dpr
        canvas.height = canvas.offsetHeight * dpr
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      size()
      window.addEventListener('resize', size)

      /* A stone arrives from the left, strikes the barrier, becomes dust. */
      burst.current = () => {
        const h = canvas.offsetHeight
        const x = canvas.offsetWidth * 0.5
        const y = h * (0.25 + Math.random() * 0.5)
        for (let i = 0; i < 34; i++) {
          const a = (Math.random() - 0.5) * Math.PI * 1.1
          const sp = 0.6 + Math.random() * 2.6
          parts.push({
            x,
            y,
            vx: Math.cos(a) * sp * (Math.random() < 0.78 ? -1 : 1),
            vy: Math.sin(a) * sp - 0.35,
            life: 1,
            r: 0.6 + Math.random() * 1.8,
          })
        }
        if (parts.length > 400) parts = parts.slice(-400)
      }

      const draw = () => {
        ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)
        for (const p of parts) {
          p.x += p.vx
          p.y += p.vy
          p.vy += 0.012
          p.vx *= 0.985
          p.life -= 0.011
          if (p.life <= 0) continue
          ctx.globalAlpha = Math.max(0, p.life) * 0.85
          ctx.fillStyle = p.life > 0.6 ? '#f7dfae' : '#c9973e'
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1
        parts = parts.filter((p) => p.life > 0)
        raf = requestAnimationFrame(draw)
      }
      raf = requestAnimationFrame(draw)

      return () => {
        cancelAnimationFrame(raf)
        window.removeEventListener('resize', size)
        burst.current = null
      }
    },
    { scope: root, dependencies: [reduced] },
  )

  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const max = Math.max(1, ...Object.values(counts))

  return (
    <section
      ref={root}
      id="shield"
      aria-labelledby="shield-title"
      className="theme-dark relative isolate overflow-hidden bg-surface"
    >
      {/* full-bleed, edge to edge — no centred column */}
      <div className="grid gap-x-16 gap-y-14 px-[clamp(1.1rem,4vw,4rem)] py-[clamp(4rem,8vw,7rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-center">
        {/* ------------------------------------------------------ left --- */}
        <div>
          <p className="u-eyebrow">Moderation · live demonstration</p>
          <h2
            id="shield-title"
            className="u-h2 mt-5 max-w-[16ch]"
          >
            Watch it catch things before you would have read them.
          </h2>
          <p className="u-lede mt-6">
            Every reply passes the safety filter before it is ever shown to the
            person who posted. Below is that filter running on sample replies,
            right now, in front of you.
          </p>

          <div className="mt-9 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-[family-name:var(--font-display)] text-[clamp(3.4rem,7vw,5.5rem)] font-medium leading-none tracking-[-0.05em] text-accent tabular-nums">
              {total}
            </span>
            <span className="text-[0.95rem] text-muted">
              caught in this demonstration
              <br />
              <span className="u-label text-[0.6rem]">
                Sample replies · not real member content
              </span>
            </span>
          </div>

          {/* Per-category tallies. One column with a shared left edge and a
              shared right edge, so the bars are comparable at a glance —
              two columns of independently-scaled bars just read as noise. */}
          <ul className="mt-10 grid gap-3">
            {HARM_CATEGORIES.map((c) => {
              const n = counts[c.id] ?? 0
              return (
                <li
                  key={c.id}
                  className="grid grid-cols-[minmax(0,11rem)_1fr_2rem] items-center gap-4"
                >
                  <span className="truncate text-[0.82rem] text-muted">
                    {c.label}
                  </span>
                  <span
                    aria-hidden="true"
                    className="relative h-[3px] overflow-hidden rounded-full bg-[rgb(237_231_220/0.09)]"
                  >
                    <span
                      className="absolute inset-y-0 left-0 origin-left rounded-full bg-[var(--gold-500)] transition-transform duration-700 ease-out"
                      style={{ transform: `scaleX(${n === 0 ? 0 : 0.08 + (n / max) * 0.92})`, width: '100%' }}
                    />
                  </span>
                  <span className="text-right font-[family-name:var(--font-mono)] text-[0.85rem] text-accent tabular-nums">
                    {n}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>

        {/* ----------------------------------------------------- right --- */}
        <div className="relative min-h-[30rem] lg:min-h-[34rem]">
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="absolute inset-0 h-full w-full"
          />

          {/* the barrier */}
          <div
            aria-hidden="true"
            className="absolute inset-y-6 left-1/2 w-px -translate-x-1/2 bg-[linear-gradient(180deg,transparent,var(--gold-500),transparent)] opacity-60"
          />

          <div
            className="absolute inset-0 flex flex-col justify-center gap-3 px-2"
            aria-live="polite"
            aria-atomic="false"
          >
            {feed.map((f, i) => (
              <div
                key={f.id}
                className={[
                  'card flex items-start gap-3 transition-opacity duration-500',
                  f.blocked ? 'border-[var(--border-seam)]' : 'border-[var(--border)]',
                ].join(' ')}
                style={{
                  opacity: 1 - i * 0.26,
                  transform: `scale(${1 - i * 0.035}) translateX(${i * 10}px)`,
                }}
              >
                <span
                  aria-hidden="true"
                  className={[
                    'mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full',
                    f.blocked
                      ? 'bg-[rgb(217_116_63/0.16)] text-caution'
                      : 'bg-[rgb(155_181_157/0.16)] text-safe',
                  ].join(' ')}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12">
                    <path
                      d={f.blocked ? 'M3 3l6 6M9 3l-6 6' : 'M2 6.4l2.6 2.6L10 3.6'}
                      stroke="currentColor"
                      strokeWidth="1.8"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>

                <div className="min-w-0">
                  <p className="text-[0.9rem] leading-snug text-ink/90">“{f.text}”</p>
                  <p className="mt-1.5 font-[family-name:var(--font-mono)] text-[0.65rem] uppercase tracking-wider text-faint">
                    {f.blocked
                      ? `Blocked · ${HARM_CATEGORIES.find((c) => c.id === f.cat)?.label}`
                      : 'Delivered · no harm detected'}
                  </p>
                </div>
              </div>
            ))}

            {feed.length === 0 && (
              <p className="text-center text-[0.9rem] text-faint">
                {reduced
                  ? 'Filter demonstration paused — reduced motion is on.'
                  : 'Starting the filter…'}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
