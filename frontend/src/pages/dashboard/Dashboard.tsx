import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CLINICIAN,
  CONTROLS,
  MOOD_SCALE,
  SCALE,
  SHARED_WEEKLY,
  SLEEP_MAX,
  SLEEP_MIN,
  SLEEP_STEP,
  STRESS_MAX,
  STRESS_SCALE,
  TASKS,
  TICKS,
  formatSleep,
  monthShape,
  rangeLabels,
  rangeWindow,
  type Metric,
  type Range,
} from '../../content/dashboard'
import { useSession } from '../../features/auth/hooks/useSession'
import { createPost } from '../../features/community/api/posts'
import { AccountPanel } from '../../features/data-rights/components/AccountPanel'
import { recordMood, type MoodCheckin } from '../../features/journal/api/journal'
import { useMoodHistory } from '../../features/journal/hooks/useJournal'
import {
  useCategories,
  useEntitlements,
  useFeed,
  useOwnPosts,
} from '../../features/community/hooks/useCommunity'
import { ApiError } from '../../lib/api/errors'
import { relativeTime } from '../../lib/format'
import { GROUP_ACCESS } from '../../content/groups'
import CommunityTab from '../../features/community/components/CommunityTab'
import GroupsTab from '../../features/groups/components/GroupsTab'
import { SetupDialog, type SetupStep } from '../../features/groups/components/SetupDialog'
import {
  DISPLAY,
  FIELD,
  FIELD_HEADING,
  HEADING,
  LABEL,
  OUTLINE,
  PATH,
  SCALE_ENDS,
  SOLID,
} from './tokens'
import { Card, CardHead, Glyph } from './ui'

/* ============================================================================
   /dashboard — the member's home.

   The screen is built around one split: the sculpture holds a still column
   and the work happens beside it. On a desktop those are two panes that
   scroll independently, so the object never slides out from under the reader.
   Below 1120px there is no column both narrow enough for a standing figure
   and wide enough to leave room beside it, so the figure lies down into a
   banner and the page becomes one scrolling document. Below 640px the rail
   moves to the bottom of the screen, where a thumb is. Those three shapes
   live in index.css as `.app-dash` / `.app-sculpt` / `.app-cards` rather than
   in class strings here, because they are the argument of the layout.

   Three numbers get recorded — mood, sleep, stress — and they feed one chart
   that can be read a week, a month or a year at a time. Each metric keeps its
   own axis: "all three" draws three lines rather than averaging them into a
   single figure, because the architecture forbids scoring a person (§7.4).
   Mood therefore records a word and never a number, and nothing anywhere is
   streaked — a gap in the record is just a gap.
   ========================================================================= */

/* ------------------------------------------------------------------- rail -- */

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: PATH.today },
  { id: 'community', label: 'Community', icon: PATH.community },
  { id: 'groups', label: 'Groups', icon: PATH.groups },
  { id: 'care', label: 'Care', icon: PATH.care },
] as const

type TabId = (typeof TABS)[number]['id']

/** The two things a member sets once before their first group session. They
    are listed on the profile card because they describe how you are seen,
    which is the subject of that card and not of a settings screen. */
const GROUP_SETUP: { id: SetupStep; title: string; body: string }[] = [
  { id: 'avatar', title: 'Your avatar', body: 'The stand-in the group sees.' },
  { id: 'presence', title: 'Before you join', body: 'Your name, camera and voice.' },
]

/** The one place the name appears. It lives on the sculpture panel rather
    than the rail — the rail is for getting around, and two wordmarks in the
    same top-left corner read as a mistake. */
function Wordmark() {
  return (
    <span className="flex items-baseline gap-[0.14em]">
      <span
        className={`${DISPLAY} text-[clamp(1.35rem,1.9vw,2rem)] leading-none text-[var(--app-ink)]`}
      >
        Alaap
      </span>
      <span
        aria-hidden="true"
        className="h-[0.18em] w-[0.18em] rounded-full bg-[var(--app-gold)] text-[clamp(1.35rem,1.9vw,2rem)]"
      />
    </span>
  )
}

/* The rail opens as one piece. Expanding each pill on its own hover meant
   four separate reveals over the content and no sense of a panel; hovering
   anywhere on the rail now slides the whole thing out, and every label
   arrives together. It is positioned rather than laid out, so opening it
   passes over the page instead of pushing it sideways. */
const RAIL_ITEM =
  'relative flex min-h-[54px] flex-1 flex-col items-center justify-center gap-1 rounded-[14px] px-1 text-center transition-colors ' +
  'sm:h-11 sm:min-h-11 sm:w-full sm:flex-none sm:flex-row sm:justify-start sm:gap-[17px] sm:overflow-hidden sm:whitespace-nowrap sm:rounded-full sm:px-[13px] sm:text-left'

/** Icon rail on anything wider than a phone; a bottom bar on a phone.
    One nav, two shapes — the tab order and the markup do not change, which
    is what keeps the two consistent for a screen reader. */
function Rail({
  tab,
  onTab,
  onLeave,
  leaving,
}: {
  tab: TabId
  onTab: (t: TabId) => void
  /** Ends the session server side, then sends them home. */
  onLeave: () => void
  leaving: boolean
}) {
  return (
    <nav
      aria-label="Sections"
      className="
        app-rail fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around gap-1
        border-t border-[var(--app-edge)] bg-[var(--app-rail)] px-1.5 pt-1
        pb-[max(0.25rem,env(safe-area-inset-bottom))]
        sm:inset-x-auto sm:inset-y-0 sm:left-0 sm:w-[74px] sm:flex-col sm:items-stretch
        sm:justify-start sm:gap-2 sm:border-r sm:border-t-0 sm:px-[15px] sm:pb-[18px]
        sm:shadow-none sm:transition-[width,box-shadow] sm:duration-200 sm:ease-[var(--ease-seam)]
        sm:hover:w-[196px] sm:hover:shadow-[10px_0_36px_rgb(26_24_20/0.08)]
        sm:has-[:focus-visible]:w-[196px]
        sm:has-[:focus-visible]:shadow-[10px_0_36px_rgb(26_24_20/0.08)]
      "
    >
      {TABS.map((t) => {
        const on = t.id === tab
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onTab(t.id)}
            aria-current={on ? 'page' : undefined}
            className={[
              RAIL_ITEM,
              on
                ? 'bg-[var(--app-ink)] text-[var(--app-rail)]'
                : 'text-[var(--app-muted)] hover:bg-[rgb(26_24_20/0.06)]',
            ].join(' ')}
          >
            <span className="grid flex-none place-items-center">
              <Glyph d={t.icon} size={17} />
            </span>
            <span className="text-[0.6rem] font-semibold leading-none sm:text-[0.8rem]">
              {t.label}
            </span>
          </button>
        )
      })}

      <div className="hidden sm:flex sm:flex-1" />

      {/* The way out. It sits at the foot of the rail, and at the end of the
          bottom bar on a phone — where hiding it would leave no exit at all.

          A button, not a link. It was a <Link to="/"> and therefore did nothing
          but change the URL: the session stayed live, so the next person to open
          the browser on a shared phone was inside somebody's account. The only
          exit-shaped control on the screen has to actually end the session. */}
      <button
        type="button"
        onClick={onLeave}
        disabled={leaving}
        title="Sign out"
        className={`${RAIL_ITEM} w-[62px] flex-none text-[var(--app-muted)] hover:bg-[rgb(26_24_20/0.06)] disabled:opacity-50`}
      >
        <span className="grid flex-none place-items-center">
          <Glyph d={PATH.leave} size={17} />
        </span>
        <span className="text-[0.6rem] font-semibold leading-none sm:text-[0.8rem]">
          {leaving ? '…' : 'Sign out'}
        </span>
      </button>
    </nav>
  )
}

/* ------------------------------------------------------------- the chart -- */

/* One viewBox for every series, stretched to the card. Strokes are marked
   non-scaling so the horizontal stretch never thickens the line. */
const VB_W = 1000
const VB_H = 200
const PAD_T = 14
const SPAN = 160

/**
 * A calendar day as the server writes it: YYYY-MM-DD in the member's own timezone.
 *
 * Not `toISOString().slice(0, 10)`, which is UTC. `entry_date` is set from the server's
 * CURRENT_DATE and read as a local day, so east of UTC the two disagree for part of
 * every night: local midnight on 1 October in IST is 30 September in UTC, and the whole
 * series would shift back a day. It read correctly only because it was being called
 * with the current time of day attached, and only when that time was late enough.
 */
function localDay(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * Turn check-ins into one point per day across a calendar period, with gaps where
 * there is no check-in.
 *
 * `null` means "nothing recorded", and it stays null all the way to the path. The
 * chart used to come from `trend()`, which generated a sine wave with seeded noise —
 * so a brand-new account displayed a month of peaks and troughs its owner had never
 * lived. On a platform whose premise is that nothing here is invented about you, a
 * fabricated record of your own moods is the worst kind of placeholder.
 *
 * The period runs to its own end, not to today, so the days after today are null as
 * well — not missing readings, just days that have not happened. They draw nothing.
 *
 * Days are keyed by date rather than by position so a missing day shifts nothing.
 */
function seriesFrom(
  checkins: MoodCheckin[],
  metric: Metric,
  period: { start: Date; length: number },
): (number | null)[] {
  const byDate = new Map<string, (typeof checkins)[number]>()
  for (const c of checkins) byDate.set(c.entryDate.slice(0, 10), c)

  const { start, length } = period
  const out: (number | null)[] = []
  for (let i = 0; i < length; i += 1) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const hit = byDate.get(localDay(d))
    if (hit === undefined) {
      out.push(null)
      continue
    }
    // Null rather than a substitute when a day holds no value for this metric.
    // Check-ins written before `stress_score` existed genuinely have no stress, and
    // `projectGapped` breaks the line there rather than bridging it.
    out.push(
      metric === 'mood'
        ? hit.moodScore
        : metric === 'sleep'
          ? (hit.sleepHours ?? null)
          : (hit.stressScore ?? null),
    )
  }
  return out
}

/**
 * A polyline that breaks across gaps rather than bridging them.
 *
 * Returned as separate `M…L…` runs: joining across a missing day would draw a line
 * through a day somebody did not record, which is the same lie as inventing a value
 * for it.
 */
type Pt = { x: number; y: number }

function runsFrom(values: (number | null)[], metric: Metric): Pt[][] {
  const [lo, hi] = SCALE[metric]
  const n = values.length
  const runs: Pt[][] = []
  let current: Pt[] = []

  values.forEach((v, i) => {
    if (v === null) {
      if (current.length > 0) runs.push(current)
      current = []
      return
    }
    const x = (i / Math.max(1, n - 1)) * VB_W
    /* Clamped to the band. A value outside the metric's scale — a row written by an
       older build, or a column whose range is wider than this control's — would
       otherwise be drawn outside the viewBox and clipped by the card, which reads as
       a chart with its top cut off rather than as a value out of range. */
    const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
    current.push({ x, y: PAD_T + (1 - t) * SPAN })
  })
  if (current.length > 0) runs.push(current)

  return runs
}

const pointsOf = (run: Pt[]) => run.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')

function projectGapped(values: (number | null)[], metric: Metric): string {
  /* A run of one gets a zero-length segment so the round linecap renders it as a dot.
     `M x,y` alone draws nothing, which on the 1st of a month — when only one day of
     the period has happened — would be an empty chart for somebody who had just
     recorded. */
  return runsFrom(values, metric)
    .map((run) => {
      const d = pointsOf(run)
      return run.length === 1 ? `M${d} L${d}` : `M${d}`
    })
    .join(' ')
}


function tickTop(metric: Metric, v: number) {
  const [lo, hi] = SCALE[metric]
  return ((PAD_T + (1 - (v - lo) / (hi - lo)) * SPAN) / VB_H) * 100
}

/* Mood is 1-7 — the value stored, not the index. MOOD_SCALE is zero-based, so every
   lookup drops one. See the note on SCALE for why it is not 0-6 any more. */
function moodWord(score: number) {
  return MOOD_SCALE[Math.max(0, Math.min(MOOD_SCALE.length - 1, Math.round(score) - 1))]
}

function readOut(metric: Metric, v: number) {
  if (metric === 'mood') return moodWord(v)
  if (metric === 'sleep') return formatSleep(v)
  return `${Math.round(v * 10) / 10} / 10`
}

function tickLabel(metric: Metric, v: number) {
  if (metric === 'mood') return moodWord(v)
  if (metric === 'sleep') return `${v}h`
  return String(v)
}

const SERIES_INK: Record<Metric, string> = {
  mood: 'var(--app-on-dark)',
  sleep: '#8fb0a0',
  stress: 'var(--app-gold-lit)',
}

function Pill({
  on,
  label,
  onClick,
}: {
  on: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      /* The design's pill is 34px, which is right for a cursor and short for a
         thumb — so a coarse pointer gets the taller one and nothing else does. */
      className={`flex-none rounded-full px-[15px] py-2 text-[0.72rem] transition-colors pointer-coarse:min-h-11 ${
        on
          ? 'bg-[var(--app-on-dark)] font-semibold text-[var(--app-ink)]'
          : 'font-medium text-[var(--app-on-dark-soft)] hover:text-[var(--app-on-dark)]'
      }`}
    >
      {label}
    </button>
  )
}

const METRIC_TABS: { id: Metric | 'all'; label: string }[] = [
  { id: 'mood', label: 'Mood' },
  { id: 'sleep', label: 'Sleep' },
  { id: 'stress', label: 'Stress' },
  { id: 'all', label: 'All three' },
]

const RANGE_TABS: { id: Range; label: string }[] = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
]

/** The one dark mass on the page. Everything about the three metrics —
    picking one, choosing a span, reading the line — happens inside it. */
function Instrument({
  metric,
  range,
  onMetric,
  onRange,
  live,
  history,
  loading,
}: {
  metric: Metric | 'all'
  range: Range
  onMetric: (m: Metric | 'all') => void
  onRange: (r: Range) => void
  live: Record<Metric, number>
  /** What the member actually recorded. Gaps are gaps. */
  history: MoodCheckin[]
  /** True while the first fetch is in flight — an empty chart is not the same as none. */
  loading: boolean
}) {
  const single: Metric = metric === 'all' ? 'mood' : metric
  /* The whole calendar period — all 28, 29, 30 or 31 days of the month — so the axis is
     the shape of the month itself. Only the days up to today hold a reading. */
  const period = useMemo(() => rangeWindow(range), [range])
  const series = seriesFrom(history, single, period)
  const recorded = series.filter((v): v is number => v !== null)

  const line = projectGapped(series, single)
  /* The fill closes under the run itself, not under the card.
     No fill when the line is broken: a filled region under a gap implies a reading on
     a day with none. And it stops where the line stops — closing at the right edge
     would shade the rest of the month, which nobody has lived yet. */
  const runs = runsFrom(series, single)
  const solo = runs.length === 1 && runs[0]!.length > 1 ? runs[0]! : null
  const area = solo
    ? `M${solo[0]!.x.toFixed(1)},${VB_H} L${pointsOf(solo)} L${solo[solo.length - 1]!.x.toFixed(1)},${VB_H} Z`
    : ''

  const avg = recorded.length > 0 ? recorded.reduce((a, b) => a + b, 0) / recorded.length : 0
  const hi = recorded.length > 0 ? Math.max(...recorded) : 0
  const lo = recorded.length > 0 ? Math.min(...recorded) : 0
  const latest = recorded.length > 0 ? recorded[recorded.length - 1]! : live[single]
  /* For stress the good day is the quiet one, so best and hardest swap. */
  const best = single === 'stress' ? lo : hi
  const hardest = single === 'stress' ? hi : lo

  /* Pinned per range rather than recomputed each render, so the axis cannot shift
     under somebody who leaves the screen open across midnight. */
  const labels = useMemo(() => rangeLabels(range), [range])
  const spanWord =
    range === 'week'
      ? 'this week'
      : range === 'month'
        ? 'this month so far'
        : 'this year so far'
  const whenWord = single === 'sleep' ? 'last night' : 'today'

  return (
    <section className="rounded-[18px] bg-[image:var(--app-dark)] p-4 text-[var(--app-on-dark)] sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Metric"
          className="flex max-w-full gap-1.5 overflow-x-auto rounded-full bg-[var(--app-on-dark-fill)] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {METRIC_TABS.map((m) => (
            <Pill key={m.id} on={metric === m.id} label={m.label} onClick={() => onMetric(m.id)} />
          ))}
        </div>
        <div
          role="group"
          aria-label="Range"
          className="flex max-w-full gap-1.5 overflow-x-auto rounded-full bg-[var(--app-on-dark-fill)] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {RANGE_TABS.map((r) => (
            <Pill key={r.id} on={range === r.id} label={r.label} onClick={() => onRange(r.id)} />
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-x-3.5 gap-y-1">
        <p
          className={`${DISPLAY} text-[clamp(1.9rem,7vw,2.75rem)] leading-none tracking-[-0.035em]`}
        >
          {metric === 'all' ? 'All three' : readOut(single, latest)}
        </p>
        <p className="pb-1.5 text-[0.75rem] leading-snug text-[var(--app-on-dark-dim)]">
          {metric === 'all'
            ? `each on its own scale · ${spanWord}`
            : `${whenWord} · ${spanWord}`}
        </p>
      </div>

      <div className="relative mt-3 h-[clamp(150px,24vw,208px)]">
        {(metric === 'all' ? [0, 1, 2, 3] : TICKS[single]).map((v, i) => (
          <div
            key={i}
            style={{ top: `${metric === 'all' ? 7 + i * 24.5 : tickTop(single, v)}%` }}
            className="absolute inset-x-0 flex -translate-y-1/2 items-center gap-2"
          >
            {/* The axis gutter is narrower on a phone, where 62px of captions
                would take a quarter of the plot. */}
            <span className="w-[46px] flex-none overflow-hidden whitespace-nowrap text-right font-[family-name:var(--font-mono)] text-[0.55rem] font-medium text-[var(--app-on-dark-dim)] sm:w-[62px]">
              {metric === 'all' ? '' : tickLabel(single, v)}
            </span>
            <span className="h-px flex-1 bg-[rgb(244_241_234/0.1)]" />
          </div>
        ))}

        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          fill="none"
          role="img"
          aria-label={
            /* No article before spanWord: it already carries one where it needs it
               ("last 7 days", "this month so far"). */
            metric === 'all'
              ? `Mood, sleep and stress over ${spanWord}, each on its own scale`
              : `${single} over ${spanWord}`
          }
          /* Width is stated rather than left to `auto`: an SVG is a replaced
             element, so an over-constrained box resolves from the viewBox's
             own ratio and the line runs off the side of the card. */
          className="absolute inset-y-0 left-[54px] h-full w-[calc(100%-54px)] sm:left-[70px] sm:w-[calc(100%-70px)]"
        >
          {metric === 'all' ? (
            /* All three, each against its own scale — the shared axis would be
               meaningless across hours and two 1-10 scales that point opposite ways. */
            (['mood', 'sleep', 'stress'] as Metric[]).map((m) => (
              <path
                key={m}
                d={projectGapped(seriesFrom(history, m, period), m)}
                stroke={SERIES_INK[m]}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))
          ) : (
            <>
              {area !== '' && <path d={area} fill="rgb(224 172 92 / 0.16)" />}
              <path
                d={line}
                stroke="var(--app-on-dark)"
                strokeWidth="2.4"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>

        {/* Three states, and none of them is the other two. A member who has not
            checked in yet is told so plainly; the chart filling in is the record of
            them starting, and an invented curve would have taken that from them. */}
        {(loading || recorded.length === 0) && (
          <div className="absolute inset-0 grid place-items-center">
            <p className="max-w-[18rem] px-4 text-center text-[0.78rem] leading-relaxed text-[var(--app-on-dark-dim)]">
              {loading
                ? 'Loading your check-ins'
                : 'Nothing recorded yet. Save today\u2019s check-in and this fills in from there.'}
            </p>
          </div>
        )}
      </div>

      <div className="mt-2 flex justify-between pl-[54px] sm:pl-[70px]">
        {labels.map((t) => (
          <span
            key={t}
            className="font-[family-name:var(--font-mono)] text-[0.55rem] font-medium tracking-[0.1em] text-[#7d766c]"
          >
            {t}
          </span>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-[var(--app-on-dark-line)] pt-3.5">
        {[
          ['Average', readOut(single, avg)],
          ['Best', readOut(single, best)],
          ['Hardest', readOut(single, hardest)],
        ].map(([k, v]) => (
          <div key={k}>
            <p className={`${DISPLAY} text-[0.95rem] leading-none`}>{v}</p>
            <p className="mt-1.5 font-[family-name:var(--font-mono)] text-[0.53rem] font-medium uppercase tracking-[0.14em] text-[var(--app-on-dark-dim)]">
              {k}
            </p>
          </div>
        ))}
        <div className="hidden flex-1 sm:block" />
        <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
          {(['mood', 'sleep', 'stress'] as Metric[]).map((m) => (
            <li key={m} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-0.5 w-3.5"
                style={{ background: SERIES_INK[m] }}
              />
              <span className="font-[family-name:var(--font-mono)] text-[0.53rem] font-medium uppercase tracking-[0.12em] text-[var(--app-on-dark-dim)]">
                {m}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------- check-in -- */

/** Mood, sleep and stress in one card, three instruments side by side. Every
    target is 40px or taller, because this is the one thing on the screen that
    gets touched daily and often one-handed. */
function CheckIn({
  mood,
  onMood,
  sleep,
  onSleep,
  stress,
  onStress,
  saved,
  onSave,
  saving,
  message,
  savedLabel,
}: {
  mood: number
  onMood: (v: number) => void
  sleep: number
  onSleep: (v: number) => void
  stress: number
  onStress: (v: number) => void
  saved: boolean
  onSave: () => void
  saving: boolean
  /** Shown under the button when a save failed. */
  message: string | null
  savedLabel: string
}) {
  const sleptPct = Math.max(0, Math.min(100, (sleep / 10) * 100))

  return (
    <section className="rounded-[18px] border border-[var(--app-edge)] bg-[var(--app-card)] p-4 sm:p-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={`${DISPLAY} text-[1rem] text-[var(--app-ink)]`}>How is today?</h2>
        <p className={`${LABEL} text-[var(--app-dim)]`}>{savedLabel}</p>
      </div>

      {/* The three fields keep one rhythm — caption, reading, control, scale
          ends — so the eye can compare across them without re-learning where
          each line sits. */}
      <div className="app-cards mt-4">
        {/* mood — seven steps, the chosen one named above them */}
        <div className={FIELD}>
          <p className={FIELD_HEADING}>Mood</p>
          <p className={`${DISPLAY} mt-2.5 text-[1.3rem] leading-none`}>{moodWord(mood)}</p>
          <div role="radiogroup" aria-label="Mood" className="mt-2 flex h-10 items-center gap-1.5">
            {/* `i + 1` is the score. The dots are a seven-step word scale, but what
                goes to the vault is 1-7 of mood_score's 1-10, because the step at
                index 0 used to be sent as 0 and refused. */}
            {MOOD_SCALE.map((word, i) => {
              const on = i + 1 === mood
              return (
                <button
                  key={word}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={word}
                  onClick={() => onMood(i + 1)}
                  className="flex h-10 flex-1 items-center justify-center"
                >
                  <span
                    className={`rounded-full transition-all duration-150 ${
                      on
                        ? 'h-[22px] w-[22px] bg-[var(--app-gold)]'
                        : i + 1 < mood
                          ? 'h-[11px] w-[11px] bg-[rgb(26_24_20/0.3)]'
                          : 'h-[11px] w-[11px] bg-[rgb(26_24_20/0.14)]'
                    }`}
                  />
                </button>
              )
            })}
          </div>
          <p className={`${SCALE_ENDS} mt-2.5`}>
            <span>{MOOD_SCALE[0]}</span>
            <span>{MOOD_SCALE[MOOD_SCALE.length - 1]}</span>
          </p>
        </div>

        {/* sleep — a stepper, because nobody knows last night to the minute */}
        <div className={FIELD}>
          <p className={FIELD_HEADING}>Slept</p>
          <p
            className={`${DISPLAY} mt-2.5 text-[1.3rem] leading-none tabular-nums`}
            aria-live="polite"
          >
            {formatSleep(sleep)}
          </p>
          <div className="mt-2 flex h-10 items-center gap-2.5">
            <button
              type="button"
              aria-label="Ten minutes less"
              onClick={() => onSleep(Math.max(SLEEP_MIN, sleep - SLEEP_STEP))}
              className="grid h-10 w-10 flex-none place-items-center rounded-full border border-[var(--app-edge-strong)] bg-[var(--app-card)] text-[1.05rem] text-[var(--app-muted)] transition-colors hover:bg-[rgb(26_24_20/0.05)]"
            >
              −
            </button>
            <div className="h-1.5 flex-1 rounded-full bg-[rgb(26_24_20/0.1)]">
              <div
                className="h-full rounded-full bg-[var(--app-ink)] transition-[width] duration-150"
                style={{ width: `${sleptPct}%` }}
              />
            </div>
            <button
              type="button"
              aria-label="Ten minutes more"
              onClick={() => onSleep(Math.min(SLEEP_MAX, sleep + SLEEP_STEP))}
              className="grid h-10 w-10 flex-none place-items-center rounded-full border border-[var(--app-edge-strong)] bg-[var(--app-card)] text-[1.05rem] text-[var(--app-muted)] transition-colors hover:bg-[rgb(26_24_20/0.05)]"
            >
              +
            </button>
          </div>
          <p className={`${SCALE_ENDS} mt-2.5`}>
            <span>10 min steps</span>
            <span>Target 7h</span>
          </p>
        </div>

        {/* stress — the one number the member sets about their day */}
        <div className={FIELD}>
          <p className={FIELD_HEADING}>Stress</p>
          <div className="mt-2.5 flex items-baseline gap-2">
            <p className={`${DISPLAY} text-[1.3rem] leading-none tabular-nums`}>
              {stress} / {STRESS_MAX}
            </p>
            <p className="text-[0.72rem] leading-none text-[var(--app-faint)]">
              {STRESS_SCALE[stress]}
            </p>
          </div>
          <div
            role="radiogroup"
            aria-label="Stress"
            className="mt-2 flex h-10 items-center gap-[3px]"
          >
            {Array.from({ length: STRESS_MAX }, (_, i) => i + 1).map((i) => {
              const on = i <= stress
              return (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={i === stress}
                  aria-label={`${i} of ${STRESS_MAX}, ${STRESS_SCALE[i]}`}
                  onClick={() => onStress(i)}
                  className="flex h-10 flex-1 items-center"
                >
                  <span
                    className={`w-full rounded-[3px] transition-all duration-150 ${
                      on
                        ? `h-[22px] ${i > 7 ? 'bg-[var(--app-gold)]' : 'bg-[rgb(26_24_20/0.55)]'}`
                        : 'h-3 bg-[rgb(26_24_20/0.14)]'
                    }`}
                  />
                </button>
              )
            })}
          </div>
          <p className={`${SCALE_ENDS} mt-2.5`}>
            <span>Calm</span>
            <span>Overloaded</span>
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <p className="min-w-[180px] flex-1 text-[0.75rem] leading-relaxed text-[var(--app-faint)]">
          Three numbers, ten seconds. They shape the chart below and nothing else.
        </p>
        <button
          type="button"
          onClick={onSave}
          className={`min-h-11 flex-none rounded-full px-5 text-[0.78rem] font-semibold transition-colors ${
            saved
              ? 'border border-[rgb(26_24_20/0.12)] bg-[var(--app-stone)] text-[var(--app-muted)]'
              : 'bg-[var(--app-ink)] text-[var(--app-rail)] hover:opacity-90'
          }`}
        >
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save today'}
        </button>
      </div>

      {message !== null && (
        <p role="status" className="mt-3 text-[0.78rem] leading-relaxed text-[var(--app-body)]">
          {message}
        </p>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------- page -- */

export default function Dashboard() {
  const [tab, setTab] = useState<TabId>('dashboard')

  /* A new tab starts at its top. The tabs share one scrolling column, so
     without this, switching kept the last tab's position and landed somebody
     halfway down a page they had never seen, which is where finishing group
     setup used to drop them. Below 640px the window scrolls instead, so both
     are reset. */
  const mainRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
    window.scrollTo({ top: 0 })
  }, [tab])

  /* Setting up how you appear in a group room is owned here rather than by
     the Groups tab, because it is reached from two places that do not share a
     tree: your profile card on this screen, and the door into a first
     session. `pending` remembers that somebody was on their way somewhere
     when we stopped them, so finishing hands them back to it. */
  const [setupComplete, setSetupComplete] = useState(GROUP_ACCESS.setupComplete)
  const [setup, setSetup] = useState<{ step: SetupStep; pending: boolean } | null>(null)
  const [inSession, setInSession] = useState(false)

  const openSetup = (step: SetupStep, reason?: 'first-join') =>
    setSetup({ step, pending: reason === 'first-join' })

  const [metric, setMetric] = useState<Metric | 'all'>('mood')
  const [range, setRange] = useState<Range>('month')
  const [tasks, setTasks] = useState(TASKS)

  /* Read once per mount rather than per render, so the labels do not shift
     under the screen if it is left open across midnight. */
  const month = useMemo(() => monthShape(), [])

  /* 4 of 1-7: "Level", the middle step. Not a guess at how somebody feels — it is
     where the control rests until they move it, and nothing is stored until they do. */
  const [mood, setMood] = useState(4)
  const [sleep, setSleep] = useState(6 + 40 / 60)
  const [stress, setStress] = useState(6)
  const [saved, setSaved] = useState(false)
  const [savingMood, setSavingMood] = useState(false)
  const [moodMsg, setMoodMsg] = useState<string | null>(null)

  /* Editing after saving reopens the draft, so the button never claims a
     value is recorded when the controls have moved on. */
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setSaved(false)
  }

  const live: Record<Metric, number> = { mood, sleep, stress }
  const doneCount = tasks.filter((t) => t.done).length
  /* Counted off the same threads the community tab reads, so the two screens
     can never disagree about how many replies are waiting. */
  /* Everything below this line comes from the server.

     Each loads independently. A dashboard that waits for all four shows an
     empty shell for as long as the slowest one takes, and three of these are
     cheap. */
  const session = useSession()

  /* Signing out. Ends the session on the server first, then navigates — in that
     order, because navigating first would leave a live session behind on a
     device the member has walked away from. `signOut` never throws; if the
     request fails we still leave, and the session expires on its own. */
  /* Which account panel is open, if any. `privacy` and `data` both open the
     data panel — "what is stored about me" and "take it or delete it" are the
     same question with different verbs, and splitting them into two screens
     would hide the second behind the first. */
  const [panel, setPanel] = useState<'consent' | 'data' | null>(null)

  const [leaving, setLeaving] = useState(false)
  async function leave() {
    if (leaving) return
    setLeaving(true)
    await session.signOut()
    window.location.assign('/')
  }
  const plan = useEntitlements()
  const community = useFeed(3)
  const own = useOwnPosts()
  const categories = useCategories()
  /* Enough for the widest range the chart can draw. It fetched 30, so the year view
     was drawing a year's axis over one month of data and leaving the rest as gaps. */
  const moodHistory = useMoodHistory(366)

  /**
   * Show today's check-in if there already is one.
   *
   * Without this the controls opened at their defaults and the card read
   * "Unsaved" even when a check-in existed — so somebody who checked in at
   * breakfast and came back at night would see the wrong numbers, and pressing
   * Save would overwrite the real entry with the defaults. A check-in replaces
   * rather than appends, which makes that silent.
   *
   * Seeded once, when the history first arrives. `seeded` guards it so a later
   * reload cannot pull the controls out from under somebody mid-edit.
   */
  const [seeded, setSeeded] = useState(false)
  useEffect(() => {
    if (seeded || moodHistory.data === undefined) return
    // Local, not UTC — see `localDay`. In IST this ran a day behind before 05:30,
    // so an early-morning check-in would not be found and Save would overwrite it.
    const today = localDay(new Date())
    const hit = moodHistory.data.find((c) => c.entryDate.slice(0, 10) === today)
    setSeeded(true)
    if (hit === undefined) return
    setMood(hit.moodScore)
    if (hit.sleepHours !== undefined && hit.sleepHours !== null) setSleep(hit.sleepHours)
    if (hit.stressScore !== undefined && hit.stressScore !== null) setStress(hit.stressScore)
    setSaved(true)
  }, [moodHistory.data, seeded])

  /**
   * Record today.
   *
   * Never gated — not by plan, not by quota, not by consent — so there is no refusal
   * to render here beyond the network failing. Writing twice in a day replaces rather
   * than appends; the server treats a check-in as a statement about a day, not an
   * event, so a member correcting theirs is not creating a second day.
   *
   * All three numbers are sent. Stress used to be collected and dropped, because
   * `mood_checkins` had no column for it — asking somebody how heavy their day was
   * and discarding the answer is worse than not asking.
   */
  async function saveToday() {
    if (savingMood) return
    setSavingMood(true)
    setMoodMsg(null)
    try {
      await recordMood({
        moodScore: Math.round(mood),
        sleepHours: Number(sleep.toFixed(2)),
        stressScore: Math.round(stress),
      })
      setSaved(true)
      moodHistory.reload()
    } catch {
      setMoodMsg('That could not be saved just now. Your numbers are still here.')
    } finally {
      setSavingMood(false)
    }
  }

  /* The quick composer on this card. It writes the same post the community tab
     writes — same endpoint, same refusals — because there is one kind of post
     and it should not behave differently depending on which screen it was
     typed on. */
  const [draft, setDraft] = useState('')
  const [chosen, setChosen] = useState('')
  const [posting, setPosting] = useState(false)
  const [postMsg, setPostMsg] = useState<string | null>(null)

  async function saySomething() {
    if (posting) return
    setPosting(true)
    setPostMsg(null)
    try {
      await createPost({ categoryId: chosen, body: draft })
      setDraft('')
      setPostMsg('Put down. It will be on the wall for five days.')
      community.reload()
      own.reload()
    } catch (err) {
      /* The draft is deliberately left in the box. Losing what somebody just
         wrote is the one thing that would make a refusal unforgivable. */
      setPostMsg(
        err instanceof ApiError && err.isQuotaExceeded
          ? 'You have used this month\u2019s posts. Nothing you wrote was lost.'
          : 'That could not be posted just now. Your words are still here.',
      )
    } finally {
      setPosting(false)
    }
  }

  const mine = (own.data ?? []).reduce(
    (a, p) => ({ posts: a.posts + 1, total: a.total + p.replyCount }),
    { posts: 0, total: 0 },
  )

  return (
    <div className="alaap-app theme-light relative flex min-h-svh flex-col bg-[var(--app-ground)] text-[var(--app-ink)] sm:h-svh sm:overflow-hidden">
      <Rail tab={tab} onTab={setTab} onLeave={() => void leave()} leaving={leaving} />

      {panel !== null && <AccountPanel section={panel} onClose={() => setPanel(null)} />}

      {/* Room for the phone's bottom bar, and for the rail — which is
          positioned rather than laid out, so that opening it slides over the
          page instead of shoving it sideways. */}
      <div
        ref={mainRef}
        className={`app-main flex min-h-0 min-w-0 flex-1 flex-col pb-[calc(66px+env(safe-area-inset-bottom))] sm:pb-0 sm:pl-[74px] ${
          tab === 'dashboard' ? 'app-main--split' : ''
        }`}
      >
        {tab === 'dashboard' ? (
          <div className="app-dash p-3 sm:p-4">
            {/* The figure. Its own pane on a desktop, a banner below that. */}
            <section className="app-sculpt">
              {/* Two crops, one standing and one lying down, chosen in CSS.
                  `<picture media>` would be the obvious way to do this, but
                  browsers do not re-run source selection when the viewport
                  changes — a tablet rotated into landscape keeps the portrait
                  crop and squeezes it into the banner. A background image is
                  re-evaluated, and still fetches only the one that matches. */}
              <div
                role="img"
                aria-label="A pale figure holding a cracked stone mended with gold"
                className="app-sculpt-figure"
              />

              {/* The only wordmark on the screen, so it carries the name at
                  every width rather than only where the figure stands. */}
              <div className="pointer-events-none absolute inset-x-4 top-4 flex items-baseline justify-between gap-3 sm:inset-x-5">
                <Wordmark />
                <span className={LABEL}>{month.short}</span>
              </div>

              <div className="app-sculpt-card pointer-events-none rounded-[14px] border border-[rgb(255_255_255/0.85)] bg-[rgb(255_255_255/0.72)] px-3.5 py-3 backdrop-blur-md">
                {/* On a phone the banner is short and this card sits on the
                    figure, so the caption folds onto the same line as the
                    readings rather than costing a row of the image. */}
                <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
                  <p className={`${LABEL} min-[560px]:mb-2 min-[560px]:w-full`}>Today so far</p>
                  <p className={`${DISPLAY} text-[1.05rem] leading-none`}>{moodWord(mood)}</p>
                  <p className="text-[0.75rem] text-[var(--app-faint)]">
                    {formatSleep(sleep)} slept
                  </p>
                  <p className="text-[0.75rem] text-[var(--app-faint)]">
                    stress {stress} / {STRESS_MAX}
                  </p>
                </div>
              </div>
            </section>

            {/* The working column. Scrolls on its own beside the figure at
                1120 and up; part of the page scroll below that. */}
            <div className="app-work flex min-h-0 min-w-0 flex-col gap-3">
              <CheckIn
                mood={mood}
                onMood={edit(setMood)}
                sleep={sleep}
                onSleep={edit(setSleep)}
                stress={stress}
                onStress={edit(setStress)}
                saved={saved}
                onSave={() => void saveToday()}
                saving={savingMood}
                message={moodMsg}
                savedLabel={saved ? `Saved · ${month.short}` : 'Unsaved'}
              />

              <Instrument
                metric={metric}
                range={range}
                history={moodHistory.data ?? []}
                loading={moodHistory.loading}
                onMetric={setMetric}
                onRange={setRange}
                live={live}
              />

              {/* Uneven on purpose. The composer and the feed take two thirds
                  and a double height between them, and the three cards that
                  only report a state take what is left beside them. */}
              <div className="app-spread">
                <Card className="sp-8">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <h2 className={HEADING}>Say something</h2>
                  <p className={`${LABEL} text-[var(--app-dim)]`}>Anonymous · expires in 5 days</p>
                </div>
                <label htmlFor="compose" className="sr-only">
                  Write a post
                </label>
                <textarea
                  id="compose"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Nothing has to be finished before you write it."
                  className="mt-4 min-h-[150px] w-full flex-1 resize-y rounded-[14px] border border-[rgb(26_24_20/0.08)] bg-[var(--app-sunken)] p-4 text-[0.9rem] leading-relaxed text-[var(--app-ink)] outline-none placeholder:text-[var(--app-dim)] focus-visible:border-[var(--app-edge-strong)] sm:min-h-[180px]"
                />
                {/* The first three topics the server serves, in its words.

                    They used to be "Anxiety", "Loneliness" and "Family" with the
                    middle one pre-selected — a condition list, hardcoded, with a
                    diagnosis chosen on the member's behalf. The server refuses
                    every one of those ids. */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {(categories.data ?? []).slice(0, 3).map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      aria-pressed={chosen === cat.id}
                      onClick={() => setChosen(cat.id)}
                      className={`min-h-11 rounded-full px-3.5 text-[0.74rem] transition-colors ${
                        chosen === cat.id
                          ? 'bg-[var(--app-ink)] font-medium text-[var(--app-rail)]'
                          : 'border border-[rgb(26_24_20/0.08)] bg-[var(--app-sunken)] text-[var(--app-muted)] hover:bg-[rgb(26_24_20/0.06)]'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={posting || draft.trim() === '' || chosen === ''}
                    onClick={() => void saySomething()}
                    className={`${SOLID} ml-auto px-5 disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    {posting ? 'Posting…' : 'Post anonymously'}
                  </button>
                </div>
                {postMsg !== null && (
                  <p role="status" className="mt-3 text-[0.78rem] leading-relaxed text-[var(--app-body)]">
                    {postMsg}
                  </p>
                )}
              </Card>

                <Card tone="stone" className="sp-4">
                  <CardHead
                    label="Practice"
                    aside={`${doneCount} of ${tasks.length}`}
                    opens={{ label: 'Open practice' }}
                  />
                  <ul className="mt-3 flex flex-col gap-0.5">
                    {tasks.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          aria-pressed={t.done}
                          onClick={() =>
                            setTasks((xs) =>
                              xs.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)),
                            )
                          }
                          className="flex min-h-11 w-full items-center gap-2.5 rounded-[12px] px-1.5 text-left text-[0.78rem] leading-snug transition-colors hover:bg-[rgb(26_24_20/0.05)]"
                        >
                          <span
                            aria-hidden="true"
                            className={`grid h-3.5 w-3.5 flex-none place-items-center rounded-full ${
                              t.done
                                ? 'bg-[var(--app-ink)] text-[var(--app-rail)]'
                                : 'border-[1.5px] border-[rgb(26_24_20/0.3)]'
                            }`}
                          >
                            {t.done && <Glyph d={PATH.check} size={9} />}
                          </span>
                          <span
                            className={
                              t.done
                                ? 'text-[var(--app-dim)] line-through'
                                : 'text-[var(--app-body)]'
                            }
                          >
                            {t.title}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>

                {/* Three at a time, each answerable where it sits. One post
                    with a single button underneath made the card look like a
                    notification; the point of the feed is that there is more
                    than one person in it. */}
                <Card className="sp-7 sp-tall">
                  <CardHead
                    label="Community"
                    aside="Newest first"
                    opens={{ label: 'Open community', to: '/community' }}
                  />
                  <ul className="mt-4 flex flex-1 flex-col gap-3">
                    {community.loading && (
                      <li className={`${LABEL} tracking-[0.12em] text-[var(--app-dim)]`}>
                        Loading
                      </li>
                    )}
                    {/* An empty feed is a real state and says so plainly. A
                        quiet hour is not an error, and it is not nothing to
                        see either — somebody has to go first. */}
                    {!community.loading && (community.data ?? []).length === 0 && (
                      <li className="rounded-[14px] bg-[var(--app-sunken)] p-3.5 text-[0.78rem] leading-relaxed text-[var(--app-body)]">
                        Nothing here yet today. If you have something to put
                        down, you would be the first.
                      </li>
                    )}
                    {(community.data ?? []).map((p) => (
                      <li key={p.ref} className="rounded-[14px] bg-[var(--app-sunken)] p-3.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <p className="font-[family-name:var(--font-mono)] text-[0.66rem] font-medium text-[var(--app-gold-ink)]">
                            {p.authorHandle}
                          </p>
                          <p className={`${LABEL} tracking-[0.12em] text-[var(--app-dim)]`}>
                            {relativeTime(p.publishedAt ?? p.createdAt)}
                          </p>
                        </div>
                        <p className="mt-2 line-clamp-2 text-[0.78rem] leading-relaxed text-[var(--app-body)]">
                          {p.body}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                          <span className="text-[0.72rem] font-semibold text-[var(--app-ink)]">
                            {p.replyCount} {p.replyCount === 1 ? 'response' : 'responses'}
                          </span>
                          <span className={`${LABEL} tracking-[0.1em] text-[var(--app-dim)]`}>
                            {(categories.data ?? []).find((cat) => cat.id === p.categoryId)?.label ??
                              p.categoryId}
                          </span>
                          <Link
                            to="/community"
                            aria-label={`Respond to ${p.authorHandle}`}
                            className={`${OUTLINE} ml-auto px-3.5 text-[0.72rem]`}
                          >
                            Respond
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>

                <Card className="sp-5">
                  <CardHead label="Care" opens={{ label: 'Open care' }} />
                  <p className="mt-3 flex-1 text-[0.78rem] leading-relaxed text-[var(--app-body)]">
                    {CLINICIAN.note}
                  </p>
                  <button type="button" className={`${SOLID} mt-4`}>
                    Message Care
                  </button>
                </Card>

                {/* Who you are here, and the two controls that are never sold:
                    what is kept about you, and what you have agreed to. They
                    belong beside the day's record rather than buried in a
                    settings screen, which is the whole claim the product makes. */}
                <Card className="sp-5">
                  <CardHead label="You" opens={{ label: 'Open your account' }} />
                  <p className="mt-3 font-[family-name:var(--font-mono)] text-[0.84rem] text-[var(--app-ink)]">
                    {session.member?.handle ?? '—'}
                  </p>
                  {/* The plan name, once the server has said which one. Nothing
                      is shown in the meantime: guessing "free" at somebody who
                      pays, even for a moment, is telling them something untrue
                      about their own account. */}
                  <p className={`${LABEL} mt-2 tracking-[0.12em] text-[var(--app-dim)]`}>
                    {plan.data?.name ?? ''}
                  </p>

                  <Link
                    to="/community"
                    className="mt-4 flex min-h-11 items-baseline gap-2 rounded-[12px] bg-[var(--app-sunken)] px-3 py-2.5 transition-colors hover:bg-[rgb(26_24_20/0.08)]"
                  >
                    <span className={`${DISPLAY} text-[1.15rem] leading-none`}>
                      {mine.total}
                    </span>
                    <span className="text-[0.72rem] leading-snug text-[var(--app-body)]">
                      replies to your {mine.posts} {mine.posts === 1 ? 'post' : 'posts'}
                    </span>
                  </Link>

                  <ul className="mt-2 flex flex-col gap-2">
                    {CONTROLS.slice(0, 2).map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setPanel(c.id === 'consent' ? 'consent' : 'data')}
                          className="flex min-h-11 w-full items-center gap-2.5 rounded-[12px] bg-[var(--app-sunken)] px-3 text-left text-[0.74rem] font-semibold text-[var(--app-ink)] transition-colors hover:bg-[rgb(26_24_20/0.08)]"
                        >
                          <span className="flex-none text-[var(--app-faint)]">
                            <Glyph d={PATH.shield} size={15} />
                          </span>
                          {c.title}
                        </button>
                      </li>
                    ))}
                  </ul>

                  {/* How you appear in a group room is part of who you are
                      here, so it sits with the handle and the consent controls
                      rather than inside the Groups tab. On a plan without
                      group care it is shown rather than hidden — you cannot
                      decide whether a thing is worth paying for from a price
                      list — and reads as unfilled stone, never a padlock. */}
                  <div className="mt-3 flex flex-1 flex-col border-t border-[var(--app-edge)] pt-3">
                    <p className={`${LABEL} tracking-[0.12em]`}>Group sessions</p>
                    <ul className="mt-2 flex flex-col gap-2">
                      {GROUP_SETUP.map((g) => (
                        <li key={g.id}>
                          <button
                            type="button"
                            disabled={!GROUP_ACCESS.subscribed}
                            onClick={() => openSetup(g.id)}
                            className={`flex min-h-11 w-full items-center gap-2.5 rounded-[12px] px-3 text-left transition-colors ${
                              GROUP_ACCESS.subscribed
                                ? 'bg-[var(--app-sunken)] hover:bg-[rgb(26_24_20/0.08)]'
                                : 'cursor-not-allowed bg-[var(--app-stone)]'
                            }`}
                          >
                            <span className="flex-none text-[var(--app-faint)]">
                              <Glyph
                                d={GROUP_ACCESS.subscribed ? PATH.pen : PATH.lock}
                                size={15}
                              />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[0.74rem] font-semibold text-[var(--app-ink)]">
                                {g.title}
                              </span>
                              <span className="mt-0.5 block text-[0.7rem] leading-snug text-[var(--app-faint)]">
                                {GROUP_ACCESS.subscribed ? g.body : GROUP_ACCESS.plan}
                              </span>
                            </span>
                            {GROUP_ACCESS.subscribed && !setupComplete && (
                              <span
                                className={`${LABEL} flex-none tracking-[0.1em] text-[var(--app-gold-ink)]`}
                              >
                                To do
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 sm:p-5">
            {/* Community and Groups each own their measure: Community is three
                zones across the whole window from 1120 up, and Groups holds a
                1240px field because several of its screens are three zones
                too. Care is a single reading column and stays centred. */}
            {tab === 'community' ? (
              <CommunityTab />
            ) : tab === 'groups' ? (
              <GroupsTab
                onOpenSetup={openSetup}
                setupComplete={setupComplete}
                inSession={inSession}
                onSession={setInSession}
              />
            ) : (
              <div className="mx-auto max-w-[940px]">
                <CareTab onOpenPanel={setPanel} />
              </div>
            )}
          </div>
        )}
      </div>

      <SetupDialog
        open={setup !== null}
        step={setup?.step ?? 'avatar'}
        onStep={(step) => setSetup((s) => (s ? { ...s, step } : s))}
        onClose={() => setSetup(null)}
        onComplete={() => {
          setSetupComplete(true)
          /* Finishing setup always lands in the group, wherever it was opened
             from: setting up how you appear in a group and then being left on
             the dashboard reads as the save having failed. Somebody who was
             stopped on their way into a room goes on into it. */
          setTab('groups')
          if (setup?.pending) setInSession(true)
          setSetup(null)
        }}
        completeLabel={
          setup?.pending
            ? 'Saving takes you into the waiting room.'
            : 'Saving takes you to your group.'
        }
      />
    </div>
  )
}

/* --------------------------------------------------------- the other tabs -- */

/* Only the dashboard carries the sculpture. The other three are their own
   full-width layouts, so nothing competes with the object for the eye. */

function PageHead({ title, note }: { title: string; note: string }) {
  return (
    <div>
      <h1 className={`${DISPLAY} text-[clamp(1.35rem,4vw,1.75rem)] leading-none`}>{title}</h1>
      <p className="mt-2 text-[0.78rem] text-[var(--app-faint)]">{note}</p>
    </div>
  )
}

function CareTab({ onOpenPanel }: { onOpenPanel: (p: 'consent' | 'data') => void }) {
  return (
    <>
      <PageHead
        title="Care"
        note="Your clinician sees numbers and summaries — never Community."
      />

      <section className="mt-4 flex flex-wrap items-center gap-4 rounded-[20px] bg-[image:var(--app-dark)] p-5 text-[var(--app-on-dark)]">
        <span
          aria-hidden="true"
          className="h-16 w-16 flex-none rounded-full bg-[rgb(244_241_234/0.12)]"
        />
        <div className="min-w-[200px] flex-1">
          <p className="font-[family-name:var(--font-mono)] text-[0.56rem] font-medium uppercase tracking-[0.16em] text-[var(--app-on-dark-dim)]">
            Your clinician
          </p>
          <h2 className={`${DISPLAY} mt-2 text-[1.2rem] leading-none`}>{CLINICIAN.name}</h2>
          <p className="mt-2 text-[0.78rem] leading-snug text-[var(--app-on-dark-soft)]">
            {CLINICIAN.next}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            className="min-h-11 rounded-full bg-[var(--app-on-dark)] px-5 text-[0.76rem] font-semibold text-[var(--app-ink)] transition-opacity hover:opacity-90"
          >
            Message
          </button>
          <button
            type="button"
            className="min-h-11 rounded-full border border-[rgb(244_241_234/0.22)] px-5 text-[0.76rem] font-medium text-[#e7e2d8] transition-colors hover:bg-[var(--app-on-dark-fill)]"
          >
            Reschedule
          </button>
        </div>
      </section>

      <div className="app-cards mt-3">
        <Card>
          <CardHead label="Shared weekly" opens={{ label: 'Open the weekly summary' }} />
          <dl className="mt-4 flex flex-col gap-3 text-[0.78rem] text-[var(--app-body)]">
            {SHARED_WEEKLY.map((row) => (
              <div key={row.label} className="flex justify-between gap-4">
                <dt>{row.label}</dt>
                <dd className="font-semibold">{row.value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card tone="stone">
          <CardHead label="If tonight is hard" />
          <p className="mt-3 flex-1 text-[0.81rem] leading-relaxed text-[var(--app-body)]">
            A listener answers within four minutes, any hour. No account details are shared.
          </p>
          <button type="button" className={`${SOLID} mt-4`}>
            Talk to someone now
          </button>
        </Card>

        {/* The full consent record. The dashboard's You card carries the two
            controls reached most often; the rest live here, each with the
            sentence that says what it actually does. */}
        <Card>
          <CardHead label="Your consent" opens={{ label: 'Open the consent record' }} />
          <ul className="mt-4 flex flex-1 flex-col gap-3">
            {CONTROLS.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  /* `safety` has no screen yet and is not pretended into one —
                     a button that opens the wrong panel is worse than one that
                     is visibly not ready. */
                  disabled={c.id === 'safety'}
                  onClick={() => onOpenPanel(c.id === 'consent' ? 'consent' : 'data')}
                  className="w-full rounded-[12px] px-1 py-1 text-left transition-colors hover:bg-[rgb(26_24_20/0.05)] disabled:opacity-45 disabled:hover:bg-transparent"
                >
                  <span className="block text-[0.78rem] font-semibold text-[var(--app-ink)]">
                    {c.title}
                  </span>
                  <span className="mt-1 block text-[0.72rem] leading-relaxed text-[var(--app-faint)]">
                    {c.body}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}
