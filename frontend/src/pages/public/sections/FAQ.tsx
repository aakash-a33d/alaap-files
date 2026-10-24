import { useState } from 'react'
import { FAQS } from '../../../content/site'
import { Reveal } from '../../../components/ui/Reveal'

function Row({
  q,
  a,
  open,
  onToggle,
  id,
}: {
  q: string
  a: string
  open: boolean
  onToggle: () => void
  id: string
}) {
  return (
    <div className="border-b border-[var(--border)]">
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          id={`${id}-button`}
          className="flex w-full items-start justify-between gap-6 py-6 text-left transition-colors duration-200 hover:text-accent"
        >
          <span className="font-[family-name:var(--font-display)] text-[clamp(1.1rem,2vw,1.4rem)] leading-snug text-ink">
            {q}
          </span>
          <span
            aria-hidden="true"
            className="mt-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[var(--border-strong)]"
          >
            <svg width="11" height="11" viewBox="0 0 12 12">
              <path
                d="M6 1v10M1 6h10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                className="origin-center transition-transform duration-300 ease-[var(--ease-seam)]"
                style={{ transform: open ? 'rotate(45deg)' : 'none' }}
              />
            </svg>
          </span>
        </button>
      </h3>

      <div
        id={`${id}-panel`}
        role="region"
        aria-labelledby={`${id}-button`}
        hidden={!open}
        className="pb-7 pr-12"
      >
        <p className="max-w-2xl text-[0.9375rem] leading-relaxed text-muted">{a}</p>
      </div>
    </div>
  )
}

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <section
      id="faq"
      className="theme-light section-y relative border-t border-[var(--border)] bg-surface"
    >
      <div className="u-shell grid gap-[clamp(2.5rem,6vw,5rem)] lg:grid-cols-[minmax(0,22rem)_1fr]">
        <Reveal>
          <p className="u-eyebrow">Straight answers</p>
          <h2 className="mt-5 text-[clamp(2rem,3.6vw,2.9rem)] text-ink">
            The questions people actually ask first
          </h2>
          <p className="mt-6 text-[0.9375rem] leading-relaxed text-muted">
            Where the honest answer is “not entirely”, that is the answer you
            will get here.
          </p>
        </Reveal>

        <Reveal delay={0.06}>
          {FAQS.map((f, i) => (
            <Row
              key={f.q}
              id={`faq-${i}`}
              q={f.q}
              a={f.a}
              open={open === i}
              onToggle={() => setOpen(open === i ? null : i)}
            />
          ))}
        </Reveal>
      </div>
    </section>
  )
}
