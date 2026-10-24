/* ============================================================================
   The signed-in surface's constants: icon path data, and the class strings
   that keep type and spacing consistent across the dashboard and the
   community workspace. Separate from ui.tsx so that file exports components
   only and Fast Refresh stays granular.

   Everything here reads the `--app-*` palette declared on `.alaap-app` in
   index.css, so these only work inside it — which is the intent: they are
   this surface's furniture, not the brand's.
   ========================================================================= */

export const PATH = {
  today: 'M10 2.5v3M10 14.5v3M2.5 10h3M14.5 10h3M10 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z',
  community: 'M3 5.5h14v9H8l-4 3v-3H3v-9Z',
  groups:
    'M7 9a2.2 2.2 0 1 0 0-4.4A2.2 2.2 0 0 0 7 9Zm6.5 0a2.2 2.2 0 1 0 0-4.4A2.2 2.2 0 0 0 13.5 9ZM2.5 16c0-2.2 2-3.6 4.5-3.6s4.5 1.4 4.5 3.6M12 12.6c2.3.15 4 1.5 4 3.4',
  care: 'M10 16.5S3.5 12.8 3.5 8.4A3.4 3.4 0 0 1 10 6.8a3.4 3.4 0 0 1 6.5 1.6c0 4.4-6.5 8.1-6.5 8.1Z',
  pen: 'M13.5 3.5 16.5 6.5 7 16H4v-3l9.5-9.5Z',
  check: 'M4.5 10.5 8 14l7.5-8',
  leave: 'M12 15.5H4.5v-11H12M8.5 10h8m0 0-3-3m3 3-3 3',
  shield: 'M10 3 4.5 5.2v4.3c0 3.3 2.3 6.2 5.5 7.5 3.2-1.3 5.5-4.2 5.5-7.5V5.2L10 3Z',
  /* the corner arrow — this card continues somewhere else */
  arrow: 'M5 15 15 5M7.5 5H15v7.5',
  reply: 'M8 5.5 3.5 10 8 14.5M3.5 10h7a6 6 0 0 1 6 6v.5',
  lock: 'M6 9V6.8a4 4 0 0 1 8 0V9M4.8 9h10.4v7.5H4.8V9Z',
  spark: 'M10 3.2l1.6 3.9 3.9 1.6-3.9 1.6L10 14.2 8.4 10.3 4.5 8.7l3.9-1.6L10 3.2Z',
  alert: 'M10 6.5v4.2M10 13.8h.01M10 3 3 16h14L10 3Z',
} as const

/* ------------------------------------------------------------- typography -- */

/** The mono caps. Metadata only — dates, counts, the ends of a scale. */
export const LABEL =
  'font-[family-name:var(--font-mono)] text-[0.56rem] font-medium uppercase tracking-[0.16em] text-[var(--app-label)]'
/** The display face, used for figures and headings only. */
export const DISPLAY = 'font-[family-name:var(--font-display)] font-medium tracking-[-0.02em]'
/** Every card's name, at one size across the screen. */
export const HEADING = `${DISPLAY} text-[0.98rem] leading-snug text-[var(--app-ink)]`
/** The name of a field inside a card — the same face, one step down. */
export const FIELD_HEADING = `${DISPLAY} text-[0.82rem] leading-none text-[var(--app-muted)]`

/* -------------------------------------------------------------- spacing -- */

/** A sunken field inside a card. */
export const FIELD = 'rounded-[14px] bg-[var(--app-sunken)] p-4'
/** The two words under a scale, naming its ends. */
export const SCALE_ENDS = `${LABEL} flex justify-between gap-2 tracking-[0.1em] text-[var(--app-dim)]`

export const SOLID =
  'flex min-h-11 items-center justify-center rounded-full bg-[var(--app-ink)] px-4 text-[0.76rem] font-semibold text-[var(--app-rail)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40'
export const OUTLINE =
  'flex min-h-11 items-center justify-center rounded-full border border-[var(--app-edge-strong)] px-4 text-[0.76rem] font-semibold text-[var(--app-ink)] transition-colors hover:bg-[rgb(26_24_20/0.05)]'
