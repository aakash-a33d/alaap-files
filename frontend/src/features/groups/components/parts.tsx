/* ============================================================================
   The Groups tab's small parts.

   The tab is built from three shapes and nothing else: a paper panel, a sand
   field sunk into it, and a pill. Everything below is one of those three, so
   seven screens that were designed independently end up made of the same
   furniture and read as one place.

   Two colours are the tab's own and are used for exactly one thing each.
   Terracotta means the therapist, or a thing that is due, or a session that is
   live — attention, never alarm. Green means done, or open, or present. They
   are declared on `.gr-room` in index.css so they cannot leak into the
   dashboard's palette.
   ========================================================================= */

export const MONO = 'font-[family-name:var(--font-mono)]'

/** The room's own face — a text serif, declared on `.gr-room`. Used for
    anything that is somebody's words rather than a piece of interface: the
    name of a group, the week's question, a therapist's note, the sentence a
    member is writing. Never for labels, counts, or buttons. */
export const SERIF = 'font-[family-name:var(--gr-display)]'

/** The mono caps above a heading. Metadata only, exactly as elsewhere on the
    signed-in surface — a date, a count, a state. */
export function Eyebrow({
  children,
  tone = 'dim',
  className = '',
}: {
  children: React.ReactNode
  /** `onDark` is the quiet label on the dark panels; `onDarkLit` is the one
      label on those panels that has to carry the accent, since terracotta at
      its light value disappears against them. */
  tone?: 'dim' | 'terra' | 'green' | 'onDark' | 'onDarkLit'
  className?: string
}) {
  const colour =
    tone === 'terra'
      ? 'text-[var(--gr-terra-ink)]'
      : tone === 'green'
        ? 'text-[var(--gr-green)]'
        : tone === 'onDark'
          ? 'text-[rgb(244_241_234/0.5)]'
          : tone === 'onDarkLit'
            ? 'text-[oklch(0.75_0.1_45)]'
            : 'text-[var(--app-dim)]'
  return (
    <p
      className={`${MONO} text-[0.6rem] font-medium uppercase leading-none tracking-[0.12em] ${colour} ${className}`}
    >
      {children}
    </p>
  )
}

/* Size is a prop rather than something a caller adds to `className`. Two
   arbitrary `text-[…]` utilities on one element are resolved by the order
   Tailwind emitted them, not by the order they were written, so an override
   passed through className wins or loses at random — which is how the live
   session's question ended up at the default size. Passing the whole value in
   means there is only ever one of them. */

/** A screen's own title. Lighter than the dashboard's card headings because
    these sit at the top of a whole view rather than on a tile. */
export function Title({
  children,
  size = 'text-[clamp(1.45rem,2.4vw,1.85rem)]',
  className = '',
}: {
  children: React.ReactNode
  size?: string
  className?: string
}) {
  return (
    <h2
      className={`${SERIF} ${size} font-light leading-tight tracking-[0.005em] text-[var(--app-ink)] ${className}`}
    >
      {children}
    </h2>
  )
}

/** The name of a panel, one step below a Title. */
export function PanelHead({
  children,
  size = 'text-[1.28rem]',
  className = '',
}: {
  children: React.ReactNode
  size?: string
  className?: string
}) {
  return (
    <h3 className={`${SERIF} ${size} font-normal leading-snug text-[var(--app-ink)] ${className}`}>
      {children}
    </h3>
  )
}

/** Warm paper with a soft drop rather than a hard edge — the tab's one card. */
export function Panel({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: React.ReactNode
  className?: string
  as?: 'section' | 'article' | 'div'
}) {
  return (
    <Tag
      className={`rounded-[20px] bg-[var(--gr-paper)] shadow-[var(--gr-lift)] ${className}`}
    >
      {children}
    </Tag>
  )
}

/** A field sunk into a panel: the therapist's brief, a step, a quoted note. */
export function Sand({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={`rounded-[14px] bg-[var(--gr-sand)] ${className}`}>{children}</div>
}

/* ------------------------------------------------------------------ pills -- */

const PILL = 'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 text-[0.8rem] transition-colors'

export const PILL_SOLID = `${PILL} bg-[var(--app-ink)] font-medium text-[var(--app-rail)] hover:bg-[#2b2721]`
export const PILL_TERRA = `${PILL} bg-[var(--gr-terra)] font-medium text-white hover:bg-[var(--gr-terra-ink)]`
export const PILL_QUIET = `${PILL} border border-[var(--gr-line-strong)] font-normal text-[var(--app-ink)] hover:bg-[rgb(26_24_20/0.05)]`
export const PILL_FLAT = `${PILL} bg-[var(--gr-paper)] font-normal text-[var(--app-muted)] hover:bg-[var(--gr-sand)]`

/** A pill that reads state rather than offering an action — a filter that is
    on, a tab within a panel. */
export function Toggle({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={on ? PILL_SOLID : PILL_FLAT}>
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ marks -- */

/** The therapist's mark. Striped rather than a photograph, because a real
    portrait drops into the same circle later and nothing else has to move. */
export function TherapistDot({ size = 24, colour }: { size?: number; colour?: string }) {
  return (
    <span
      aria-hidden="true"
      className="block flex-none rounded-full"
      style={{
        width: size,
        height: size,
        background: colour ?? 'var(--gr-terra)',
        backgroundImage:
          'repeating-linear-gradient(-45deg, rgb(255 255 255 / 0.18) 0 4px, transparent 4px 8px)',
        boxShadow: colour ? undefined : '0 0 0 2px rgb(173 101 63 / 0.3)',
      }}
    />
  )
}

/** A finished thing. Filled green with a tick; an unfinished one is the same
    circle left open in terracotta, never a red cross. */
export function Tick({ done, size = 19 }: { done: boolean; size?: number }) {
  return done ? (
    <span
      aria-hidden="true"
      className="grid flex-none place-items-center rounded-full bg-[var(--gr-green)] text-white"
      style={{ width: size, height: size, fontSize: size * 0.58 }}
    >
      ✓
    </span>
  ) : (
    <span
      aria-hidden="true"
      className="block flex-none rounded-full border-[1.5px] border-[var(--gr-terra)]"
      style={{ width: size, height: size }}
    />
  )
}

/** A bar that reads a proportion of something countable. Never a score. */
export function Meter({ fill, tone = 'green' }: { fill: number; tone?: 'green' | 'terra' }) {
  return (
    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[rgb(26_24_20/0.1)]">
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.round(fill * 100)}%`,
          background: tone === 'terra' ? 'var(--gr-terra)' : 'var(--gr-green)',
        }}
      />
    </div>
  )
}

/** The way back from a screen that was opened by a link on a card. Every
    screen here has exactly one way in, so it needs exactly one way out and it
    goes at the top left where a back control is looked for. */
export function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-9 items-center gap-2 text-[0.78rem] font-medium text-[var(--app-muted)] transition-colors hover:text-[var(--app-ink)]"
    >
      <span aria-hidden="true">←</span>
      {label}
    </button>
  )
}

/** The hairline between two parts of a panel. */
export function Rule({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`h-px bg-[var(--gr-line)] ${className}`} />
}

/** A quoted line from the therapist. Set in the display face, italic, because
    it is the one thing on the screen written by a person about this person. */
export function Quote({
  children,
  size = 'text-[1rem]',
  leading = 'leading-relaxed',
  className = '',
}: {
  children: React.ReactNode
  size?: string
  leading?: string
  className?: string
}) {
  return (
    <p
      className={`${SERIF} ${size} ${leading} font-normal italic text-[var(--app-ink)] ${className}`}
    >
      “{children}”
    </p>
  )
}
