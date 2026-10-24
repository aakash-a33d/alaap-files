import { Link } from 'react-router-dom'
import { HEADING, LABEL, PATH } from './tokens'

/* ============================================================================
   The signed-in surface's small parts.

   Extracted so the dashboard and the community workspace share one set rather
   than two that drift. Everything here reads the `--app-*` palette declared on
   `.alaap-app` in index.css, so these components only work inside it — which
   is the intent: they are this surface's furniture, not the brand's.
   ========================================================================= */

/* ------------------------------------------------------------------ icons -- */

export function Glyph({ d, size = 17 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/* -------------------------------------------------------------- surfaces -- */

export function Card({
  tone = 'paper',
  className = '',
  children,
}: {
  tone?: 'paper' | 'stone'
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      className={`flex flex-col rounded-[18px] border p-4 sm:p-5 ${
        tone === 'stone'
          ? 'border-[rgb(26_24_20/0.08)] bg-[var(--app-stone)]'
          : 'border-[var(--app-edge)] bg-[var(--app-card)]'
      } ${className}`}
    >
      {children}
    </section>
  )
}

/** The corner arrow. It marks a card whose subject continues on a screen of
    its own, so a card that only reads back a number never wears one. */
export function OpensElsewhere({ label, to }: { label: string; to?: string }) {
  const cls =
    'grid h-9 w-9 flex-none place-items-center rounded-full bg-[rgb(26_24_20/0.05)] text-[var(--app-ink)] transition-colors hover:bg-[rgb(26_24_20/0.1)]'
  return to ? (
    <Link to={to} aria-label={label} className={cls}>
      <Glyph d={PATH.arrow} size={15} />
    </Link>
  ) : (
    <button type="button" aria-label={label} className={cls}>
      <Glyph d={PATH.arrow} size={15} />
    </button>
  )
}

/** A card's top line: its name, an optional aside, and the corner arrow. */
export function CardHead({
  label,
  aside,
  opens,
}: {
  label: string
  aside?: string
  opens?: { label: string; to?: string }
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className={HEADING}>{label}</h2>
        {aside && <p className={`${LABEL} tracking-[0.1em] text-[var(--app-dim)]`}>{aside}</p>}
      </div>
      {opens && <OpensElsewhere {...opens} />}
    </div>
  )
}

/** A pseudonymous handle. Always mono, always the gold ink — a handle is the
    whole identity anyone gets here, so it is set consistently everywhere. */
export function Handle({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-[family-name:var(--font-mono)] text-[0.68rem] font-medium text-[var(--app-gold-ink)]">
      {children}
    </span>
  )
}
