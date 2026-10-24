import { useCallback, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { PLANS, type Plan } from '../../../content/site'
import { Reveal } from '../../../components/ui/Reveal'

/* ============================================================================
   PRICING

   Every card is identical at rest — same surface, same border, same weight.
   The featured plan is marked with a label, not a different colour, so the
   set reads as a row of equals you are choosing between rather than one
   option pre-selected for you.

   Colour belongs to the pointer: whichever card you are on lifts, warms and
   draws a gold hairline that brightens from wherever the cursor sits. The
   effect is keyboard-reachable too, via :focus-within.
   ========================================================================= */

function Tick({ dim }: { dim?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      className={[
        'mt-[0.15rem] shrink-0',
        dim ? 'text-faint' : 'text-accent',
      ].join(' ')}
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="7.25"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.3"
      />
      <path
        d="M4.9 8.3l2.2 2.2 4-4.6"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PlanCard({ plan, subsidised }: { plan: Plan; subsidised: boolean }) {
  const showSubsidy = subsidised && plan.subsidised !== null
  const price = showSubsidy ? plan.subsidised! : plan.standard
  /* Only strike a real numeric price. Striking a phrase like "Set by
     provider" reads as a correction rather than a discount. */
  const struck =
    showSubsidy &&
    plan.subsidised !== plan.standard &&
    plan.standard.startsWith('₹')

  const isWordy = price.length > 8

  /* Feed the pointer position to the card's gradients. Writing custom
     properties avoids a React state update per mousemove. */
  const onMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget
    const b = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - b.left}px`)
    el.style.setProperty('--my', `${e.clientY - b.top}px`)
  }, [])

  return (
    <article
      onPointerMove={onMove}
      className="plan-card flex flex-col p-[clamp(1.5rem,2.2vw,2rem)]"
    >
      {/* The badge gets its own reserved row rather than sitting beside the
          title. Inline, it stole width and wrapped the featured plan's name to
          two lines, which pushed that one card's price out of line with the
          other three. */}
      <div className="mb-3 flex h-6 items-start">
        {plan.featured && (
          <span className="chip chip--accent">Most chosen</span>
        )}
      </div>

      <h3 className="text-[1.18rem] leading-tight text-ink">{plan.name}</h3>

      <p className="mt-2.5 min-h-[3.2rem] text-[0.875rem] leading-relaxed text-muted">
        {plan.summary}
      </p>

      {/* ------------------------------------------------------- price --- */}
      <div className="mt-6 border-t border-[var(--border)] pt-6">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span
            /* keyed on the price so a toggle re-mounts and re-animates it */
            key={price}
            className={[
              'font-[family-name:var(--font-display)] font-medium leading-none tracking-[-0.04em] text-ink',
              'motion-safe:animate-[priceIn_0.42s_var(--ease-seam)]',
              isWordy
                ? 'text-[clamp(1.1rem,1.5vw,1.28rem)] leading-snug'
                : 'text-[clamp(2.2rem,3.4vw,2.9rem)]',
            ].join(' ')}
          >
            {price}
          </span>
          {struck && (
            <span className="font-[family-name:var(--font-mono)] text-[0.8125rem] text-faint line-through">
              {plan.standard}
            </span>
          )}
        </div>
        <span className="mt-2 block text-[0.8125rem] text-faint">
          {plan.cadence}
        </span>
      </div>

      {showSubsidy && plan.subsidyNote && (
        <p className="mt-4 rounded-[var(--radius-sm)] border border-[var(--border-seam)] bg-[var(--accent-wash)] px-3 py-2 font-[family-name:var(--font-mono)] text-[0.6875rem] leading-relaxed text-accent">
          {plan.subsidyNote}
        </p>
      )}

      {/* ---------------------------------------------------- features --- */}
      <ul className="mt-7 flex flex-1 flex-col gap-3.5">
        {plan.features.map((f, i) => (
          <li
            key={f}
            className="flex gap-2.5 text-[0.875rem] leading-relaxed text-muted"
          >
            {/* the first item on a paid plan is "everything in X" — dim its
                tick so the genuinely new features read as the list */}
            <Tick dim={i === 0 && f.startsWith('Everything in')} />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {/* Was #start, which scrolled to the closing band — whose own CTA
          pointed back up at pricing. Every plan now goes where it says, and
          carries which plan it was: sign-up asks for a postal code outright
          when the chosen plan is one that cannot work without it. */}
      <Link to={`/join?plan=${plan.id}`} className="btn btn--primary mt-8 w-full">
        {plan.cta}
      </Link>
    </article>
  )
}

export function Pricing() {
  const [subsidised, setSubsidised] = useState(false)
  const labelId = useId()

  return (
    <section
      id="pricing"
      aria-labelledby="pricing-title"
      className="theme-light relative border-t border-[var(--border)] bg-sunken"
    >
      <div className="px-[clamp(1.1rem,4vw,4rem)] py-[clamp(4rem,8vw,7rem)]">
        <Reveal className="grid gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <p className="u-eyebrow">Membership</p>
            <h2 id="pricing-title" className="u-h2 mt-5">
              Start free. Pay only
              <br />
              when you want more.
            </h2>
          </div>

          <div className="flex flex-col items-start gap-6 lg:items-end">
            <p className="u-lede lg:text-right">
              The free tier is not a trial and does not expire. Paid plans exist
              because therapists, moderation and safety review cost money — and
              we would rather charge you than sell what you wrote.
            </p>

            {/* standard vs Care Access toggle */}
            <div className="flex items-center gap-4 rounded-full border border-[var(--border)] bg-[var(--surface-raised)] py-2.5 pl-5 pr-2.5 shadow-[var(--shadow-card)]">
              <span id={labelId} className="u-label text-[0.625rem]">
                Show Care Access pricing
              </span>
              {/* 32px of visible switch, centred in a 44px touch target */}
              <button
                type="button"
                role="switch"
                aria-checked={subsidised}
                aria-labelledby={labelId}
                onClick={() => setSubsidised((v) => !v)}
                className="grid h-11 w-[3.75rem] shrink-0 place-items-center rounded-full"
              >
                <span
                  aria-hidden="true"
                  className={[
                    'relative block h-8 w-[3.75rem] rounded-full border transition-colors duration-300',
                    subsidised
                      ? 'border-[var(--border-seam)] bg-[var(--accent-wash)]'
                      : 'border-[var(--border-strong)] bg-[rgb(20_18_15/0.04)]',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'absolute top-1/2 block h-6 w-6 -translate-y-1/2 rounded-full transition-all duration-300 ease-[var(--ease-seam)]',
                      subsidised
                        ? 'left-[1.875rem] bg-[var(--gold-600)]'
                        : 'left-1 bg-[var(--stone-400)]',
                    ].join(' ')}
                  />
                </span>
              </button>
            </div>
          </div>
        </Reveal>

        <Reveal
          className="mt-[clamp(2.5rem,5vw,4rem)] grid items-stretch gap-5 sm:grid-cols-2 xl:grid-cols-4"
          stagger={0.07}
        >
          {PLANS.map((plan) => (
            <PlanCard key={plan.id} plan={plan} subsidised={subsidised} />
          ))}
        </Reveal>

        <Reveal className="mt-10">
          <p className="max-w-3xl text-[0.8125rem] leading-relaxed text-faint">
            Care Access pricing is funded by named NGO, CSR, university and
            employer partners. Wherever a subsidised rate appears you will also
            see the standard price, the funder covering the difference, the
            eligibility rule and how many places are left. It is never described
            as a government subsidy unless the funding genuinely is one.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
