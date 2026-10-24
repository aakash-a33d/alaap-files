import { useState } from 'react'
import {
  ATTENDANCE,
  CHECK_IN,
  MOMENTS,
  REPORT_FOOTNOTE,
  SHAPE,
  WORK_ON,
} from '../../../content/groups'
import {
  Eyebrow,
  Meter,
  MONO,
  Panel,
  PanelHead,
  Quote,
  Rule,
  SERIF,
  Title,
  Toggle,
} from './parts'

/* ============================================================================
   1k — reports and progress. Four honest readings.

   None of them is a score, and the screen is arranged so that no two of them
   can be added together into one. What the member said about their own weeks;
   the shape of how they take part, against their own first cycle and never
   against the other six; what they showed up to and finished, counted; and
   what the therapist actually wrote, in her words, released only once she has
   approved it.

   The one number that could be read as a grade — share of group speaking time
   — is given the figure an even share would be, right underneath it. That is
   the difference between a measurement and a judgement.
   ========================================================================= */

export function ReportsView() {
  const [range, setRange] = useState<'cycle' | 'all'>('cycle')

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>reports · cycle 2 · weeks 1–8</Eyebrow>
          <Title className="mt-2.5">Where you are, as far as anyone can tell</Title>
        </div>
        <div className="flex flex-wrap gap-2">
          <Toggle on={range === 'cycle'} onClick={() => setRange('cycle')}>
            This cycle
          </Toggle>
          <Toggle on={range === 'all'} onClick={() => setRange('all')}>
            All time
          </Toggle>
          <button
            type="button"
            className="inline-flex min-h-10 items-center rounded-full bg-[var(--gr-paper)] px-5 text-[0.8rem] text-[var(--app-muted)] transition-colors hover:bg-[var(--gr-sand)]"
          >
            Export PDF
          </button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        {/* ---- what you said about your own weeks ----------------------- */}
        <Panel className="p-6 sm:p-7">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <PanelHead>Weekly check-in</PanelHead>
              <p className="mt-1 text-[0.72rem] text-[var(--app-muted)]">
                what you reported, not what we measured
              </p>
            </div>
            <ul className="flex gap-3.5 text-[0.72rem] text-[var(--app-muted)]">
              <li className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-0.5 w-3.5 bg-[var(--gr-green)]" />
                anxiety
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-0.5 w-3.5 bg-[var(--gr-terra)]" />
                mood
              </li>
            </ul>
          </div>

          <CheckInChart />

          <ul
            className={`${MONO} mt-2 flex justify-between text-[0.6rem] text-[var(--app-dim)]`}
          >
            {CHECK_IN.weeks.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>

          <div className="mt-5 flex gap-3 border-t border-[var(--gr-line)] pt-4">
            <span aria-hidden="true" className="w-[3px] flex-none rounded-full bg-[var(--gr-green)]" />
            <p className="text-[0.78rem] leading-relaxed text-[var(--app-muted)]">
              {CHECK_IN.note}
            </p>
          </div>
        </Panel>

        {/* ---- the shape of taking part, against your own first cycle ---- */}
        <Panel className="p-6 sm:p-7">
          <PanelHead>The shape of your participation</PanelHead>
          <p className="mt-1 text-[0.72rem] text-[var(--app-muted)]">
            this cycle vs your first cycle
          </p>

          <div className="mt-3 flex justify-center">
            <ShapeChart />
          </div>

          <ul className="mt-1 grid gap-x-4 gap-y-2 text-[0.72rem] text-[var(--app-muted)] sm:grid-cols-2">
            {SHAPE.axes.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>

          <ul className="mt-4 flex gap-4 border-t border-[var(--gr-line)] pt-3.5 text-[0.72rem] text-[var(--app-muted)]">
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-0.5 w-3 bg-[var(--gr-terra)]" />
              this cycle
            </li>
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="w-3 border-t-[1.5px] border-dashed border-[rgb(26_24_20/0.4)]"
              />
              first cycle
            </li>
          </ul>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        {/* ---- what you turned up to and finished, counted -------------- */}
        <Panel className="p-6 sm:p-7">
          <PanelHead>Showing up</PanelHead>
          <div className="mt-4 flex items-end gap-4">
            <p>
              <span className={`${SERIF} text-[2.4rem] leading-none text-[var(--app-ink)]`}>
                {ATTENDANCE.attended}
              </span>
              <span className="mt-1 block text-[0.72rem] text-[var(--app-muted)]">
                of {ATTENDANCE.held} held
              </span>
            </p>
            {/* Marks, not a streak. The last one is the session that has not
                happened yet — nothing here resets and nothing is at risk. */}
            <ul aria-hidden="true" className="flex flex-1 items-end gap-[3px] pb-1">
              {Array.from({ length: ATTENDANCE.cycle }, (_, i) => (
                <li
                  key={i}
                  className={`h-[30px] flex-1 rounded-[3px] ${
                    i < ATTENDANCE.attended
                      ? 'bg-[var(--gr-terra)]'
                      : 'border border-dashed border-[rgb(26_24_20/0.2)] bg-[rgb(26_24_20/0.06)]'
                  }`}
                />
              ))}
            </ul>
          </div>

          <Rule className="my-5" />

          <ul className="flex flex-col gap-3.5">
            {ATTENDANCE.lines.map((l) => (
              <li key={l.label}>
                <p className="flex justify-between gap-3 text-[0.78rem] text-[var(--app-muted)]">
                  <span>{l.label}</span>
                  <span className="text-[var(--app-ink)]">{l.value}</span>
                </p>
                <Meter fill={l.fill} tone={l.tone === 'terra' ? 'terra' : 'green'} />
                {l.note && (
                  <p className="mt-1.5 text-[0.68rem] text-[var(--app-dim)]">{l.note}</p>
                )}
              </li>
            ))}
          </ul>
        </Panel>

        {/* ---- what she actually wrote ---------------------------------- */}
        <Panel className="p-6 sm:p-7">
          <PanelHead>Moments Dr. Osei noted</PanelHead>
          <p className="mt-1 text-[0.72rem] text-[var(--app-muted)]">
            written by her, visible to you
          </p>
          <ol className="mt-5">
            {MOMENTS.map((m, i) => (
              <li key={m.id} className="flex gap-3.5">
                <span aria-hidden="true" className="flex flex-none flex-col items-center">
                  <span
                    className="h-[9px] w-[9px] rounded-full"
                    style={{
                      background:
                        m.tone === 'terra'
                          ? 'var(--gr-terra)'
                          : m.tone === 'green'
                            ? 'var(--gr-green)'
                            : 'rgb(26 24 20 / 0.3)',
                    }}
                  />
                  {i < MOMENTS.length - 1 && (
                    <span className="w-px flex-1 bg-[var(--gr-line-strong)]" />
                  )}
                </span>
                <div className={i < MOMENTS.length - 1 ? 'pb-5' : ''}>
                  <Eyebrow>{m.when}</Eyebrow>
                  <Quote size="text-[0.94rem]" className="mt-1.5">{m.quote}</Quote>
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        {/* ---- and what she is asking for next --------------------------- */}
        <section className="rounded-[20px] bg-[var(--gr-sand)] p-6 sm:p-7">
          <PanelHead>What she’d like you to work on</PanelHead>
          <p className="mt-1 text-[0.72rem] text-[var(--app-muted)]">
            two things at a time, never more
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {WORK_ON.map((w) => (
              <li key={w.id}>
                <article
                  className={`rounded-[14px] bg-[var(--gr-paper)] p-4 ${
                    w.state === 'closed' ? 'opacity-70' : ''
                  }`}
                >
                  <Eyebrow tone={w.state === 'closed' ? 'green' : 'terra'}>{w.flag}</Eyebrow>
                  <h4
                    className={`mt-2 text-[0.8rem] font-semibold leading-relaxed text-[var(--app-ink)] ${
                      w.state === 'closed' ? 'line-through decoration-[rgb(26_24_20/0.3)]' : ''
                    }`}
                  >
                    {w.title}
                  </h4>
                  {w.body && (
                    <p className="mt-1.5 text-[0.72rem] leading-relaxed text-[var(--app-muted)]">
                      {w.body}
                    </p>
                  )}
                </article>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[0.72rem] leading-relaxed text-[var(--app-muted)]">
            {REPORT_FOOTNOTE}
          </p>
        </section>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ charts -- */

const W = 620
const H = 190
/** The plotted band, leaving room for the point marker at either extreme. */
const TOP = 20
const BOTTOM = 176

const y = (v: number) => BOTTOM - (v / 100) * (BOTTOM - TOP)
const x = (i: number, n: number) => 10 + (i / (n - 1)) * (W - 20)

function line(values: readonly number[]) {
  return values.map((v, i) => `${x(i, values.length)},${y(v)}`).join(' ')
}

/** Eight weeks of the member's own report, two series. Higher is more of the
    thing named, so the two lines crossing is the whole story of the cycle. */
function CheckInChart() {
  const last = CHECK_IN.weeks.length - 1
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-4 h-[190px] w-full overflow-visible"
      role="img"
      aria-label={`Weekly check-in, weeks 1 to 8. Anxiety fell from ${CHECK_IN.anxiety[0]} to ${CHECK_IN.anxiety[last]}; mood rose from ${CHECK_IN.mood[0]} to ${CHECK_IN.mood[last]}, both on your own 0 to 100 scale.`}
    >
      {[30, 80, 130].map((gy) => (
        <line key={gy} x1="0" y1={gy} x2={W} y2={gy} stroke="var(--gr-line)" />
      ))}
      <line x1="0" y1={BOTTOM} x2={W} y2={BOTTOM} stroke="var(--gr-line-strong)" />

      <polyline
        points={line(CHECK_IN.anxiety)}
        fill="none"
        stroke="var(--gr-green)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points={line(CHECK_IN.mood)}
        fill="none"
        stroke="var(--gr-terra)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <circle cx={x(last, 8)} cy={y(CHECK_IN.anxiety[last])} r="4.5" fill="var(--gr-green)" />
      <circle cx={x(last, 8)} cy={y(CHECK_IN.mood[last])} r="4.5" fill="var(--gr-terra)" />

      {/* the week the caption is about, marked rather than annotated */}
      <circle
        cx={x(CHECK_IN.marker, 8)}
        cy={y(CHECK_IN.anxiety[CHECK_IN.marker])}
        r="4"
        fill="var(--gr-paper)"
        stroke="var(--gr-green)"
        strokeWidth="2"
      />
    </svg>
  )
}

const CX = 130
const CY = 120
const R = 96

function radar(values: readonly number[]) {
  return values
    .map((v, i) => {
      const a = ((-90 + (360 / values.length) * i) * Math.PI) / 180
      return `${(CX + Math.cos(a) * R * v).toFixed(1)},${(CY + Math.sin(a) * R * v).toFixed(1)}`
    })
    .join(' ')
}

/** Five axes, this cycle solid against the member's own first cycle dashed.
    Never against another member — comparing two people in a therapy group is
    the one comparison this product will not draw. */
function ShapeChart() {
  return (
    <svg
      viewBox="0 0 260 240"
      className="h-[240px] w-[260px] max-w-full"
      role="img"
      aria-label={`Your participation this cycle against your first cycle, across ${SHAPE.axes.join(', ')}. Every axis is higher than it was.`}
    >
      {[R, R * 0.67, R * 0.33].map((r) => (
        <circle key={r} cx={CX} cy={CY} r={r} fill="none" stroke="var(--gr-line)" />
      ))}
      {SHAPE.axes.map((a, i) => {
        const t = ((-90 + (360 / SHAPE.axes.length) * i) * Math.PI) / 180
        return (
          <line
            key={a}
            x1={CX}
            y1={CY}
            x2={CX + Math.cos(t) * R}
            y2={CY + Math.sin(t) * R}
            stroke="var(--gr-line)"
          />
        )
      })}

      <polygon
        points={radar(SHAPE.before)}
        fill="rgb(26 24 20 / 0.06)"
        stroke="rgb(26 24 20 / 0.28)"
        strokeWidth="1.5"
        strokeDasharray="4 3"
      />
      <polygon
        points={radar(SHAPE.now)}
        fill="oklch(0.6 0.12 42 / 0.14)"
        stroke="var(--gr-terra)"
        strokeWidth="2"
      />
      {SHAPE.now.map((v, i) => {
        const a = ((-90 + (360 / SHAPE.now.length) * i) * Math.PI) / 180
        return (
          <circle
            key={SHAPE.axes[i]}
            cx={CX + Math.cos(a) * R * v}
            cy={CY + Math.sin(a) * R * v}
            r="3.5"
            fill="var(--gr-terra)"
          />
        )
      })}
    </svg>
  )
}
