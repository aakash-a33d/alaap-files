import {
  GREETING,
  GROUP,
  LATEST_NOTE,
  MATCHES,
  HIRE,
  OWN_GROUP,
  PROGRESS,
  SHORTLIST_NOTE,
  TASKS,
} from '../../../content/groups'
import { useMyGroupName } from '../model/groupName'
import { useSessionClock } from '../model/session'
import { ParticipantCircle } from './ParticipantCircle'
import {
  Eyebrow,
  MONO,
  Panel,
  PanelHead,
  PILL_QUIET,
  PILL_SOLID,
  PILL_TERRA,
  Quote,
  Rule,
  Sand,
  SERIF,
  TherapistDot,
  Tick,
  Title,
} from './parts'
import type { GroupView } from './views'

/* ============================================================================
   1a — the week ahead.

   One calm scroll. The countdown leads because it is the only thing on the
   screen with a deadline attached to it; everything under it is a card the
   member is allowed to ignore this week without anything being taken away.

   The order is deliberate and is not a ranking of importance: when you next
   sit down with these people, what you said you'd do before then, how the
   eight weeks have gone, and only then rooms you are not in. Putting the
   shortlist above the group you are already in would be selling.
   ========================================================================= */

export function WeekView({
  go,
  onEnterSession,
  onChangePresence,
}: {
  go: (v: GroupView) => void
  /** enter the waiting room, or join a session already running */
  onEnterSession: () => void
  /** open the setup dialog on the "how you appear" step */
  onChangePresence: () => void
}) {
  const open = TASKS.filter((t) => !t.done)
  const done = TASKS.filter((t) => t.done)
  const clock = useSessionClock()
  const myName = useMyGroupName(GROUP.id, '')

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Title>Your week ahead</Title>
        <p className="mt-2 text-[0.82rem] text-[var(--app-faint)]">{GREETING.note}</p>
      </div>

      {/* ---- the countdown, and the room it counts down to ---------------- */}
      <Panel className="grid overflow-hidden lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="p-6 sm:p-8">
          <Eyebrow tone={clock.live ? 'terra' : 'dim'}>
            {clock.live ? 'in session now' : 'next session'}
          </Eyebrow>

          {/* A running clock, not three printed figures. The smallest unit is
              always one that moves, and it is the one lit — what you look at
              when it is two days away is the days, and what you look at in
              the last minute is the seconds. */}
          {clock.live ? (
            <p className="mt-3 flex items-center gap-3">
              <span
                aria-hidden="true"
                className="gr-live-dot h-3 w-3 rounded-full bg-[var(--gr-terra)]"
              />
              <span
                className={`${SERIF} text-[clamp(2.2rem,5vw,3.2rem)] font-normal leading-[0.9] text-[var(--gr-terra)]`}
              >
                Started
              </span>
            </p>
          ) : (
            <p className="mt-3 flex flex-wrap items-end gap-x-2.5 gap-y-1 tabular-nums">
              {clock.units.map((c, i) => (
                <span key={c.unit} className="flex items-end gap-1">
                  <span
                    className={`${SERIF} text-[clamp(2.2rem,5vw,3.4rem)] font-normal leading-[0.86] ${
                      i === clock.units.length - 1
                        ? 'text-[var(--gr-terra)]'
                        : 'text-[var(--app-ink)]'
                    }`}
                  >
                    {c.value}
                  </span>
                  <span className="pb-1.5 text-[0.86rem] text-[var(--app-muted)]">{c.unit}</span>
                </span>
              ))}
            </p>
          )}
          {/* Read once, rather than four changing figures every second. */}
          <span aria-live="polite" className="sr-only">
            {clock.spoken}
          </span>

          <Rule className="my-5" />

          <PanelHead size="text-[1.42rem]">{GROUP.title}</PanelHead>
          <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.84rem] text-[var(--app-muted)]">
            <span>{clock.when}</span>
            <span aria-hidden="true" className="text-[var(--app-dim)]">
              ·
            </span>
            <span>{GROUP.length}</span>
            <span aria-hidden="true" className="text-[var(--app-dim)]">
              ·
            </span>
            <span>{GROUP.position}</span>
          </p>

          <p className="mt-3.5 flex flex-wrap items-center gap-2 text-[0.84rem] text-[var(--app-ink)]">
            <TherapistDot />
            Led by {GROUP.therapist}
            <span className={`${MONO} pl-1 text-[0.6rem] uppercase tracking-[0.08em] text-[var(--app-dim)]`}>
              {GROUP.credential}
            </span>
          </p>

          <div className="mt-6 flex flex-wrap gap-2.5">
            {/* The same button all week; it changes what it says the moment
                the clock reaches the hour, because at that moment there is a
                room rather than a wait. */}
            <button
              type="button"
              onClick={onEnterSession}
              className={clock.live ? PILL_TERRA : PILL_SOLID}
            >
              {clock.live && (
                <span aria-hidden="true" className="gr-live-dot h-1.5 w-1.5 rounded-full bg-white" />
              )}
              {clock.live ? 'Join session' : 'Enter the waiting room'}
            </button>
            <button type="button" onClick={() => go('tasks')} className={PILL_QUIET}>
              Finish task before Tue
            </button>
          </div>

          {/* How the member will be in the room, on the screen they will be
              looking at beforehand rather than in a settings page. */}
          <p className="mt-4 flex flex-wrap items-center gap-1.5 text-[0.76rem] text-[var(--app-muted)]">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--gr-green)]" />
            {myName ? (
              <>
                You’ll join as{' '}
                <span className="font-semibold text-[var(--app-ink)]">{myName}</span>, {GROUP.presence}.
              </>
            ) : (
              <>You haven’t chosen your name in this group yet.</>
            )}
            <button
              type="button"
              onClick={onChangePresence}
              className="border-b border-[var(--gr-terra-edge)] text-[var(--gr-terra-ink)] transition-colors hover:border-[var(--gr-terra)]"
            >
              Change
            </button>
          </p>
        </div>

        <div className="flex flex-col items-center justify-center gap-3.5 bg-[var(--gr-sand)] px-5 py-7">
          <Eyebrow>your circle · {GROUP.members} members</Eyebrow>
          <ParticipantCircle size={248} speaking={-1} labels={false} />
          <p className="max-w-[240px] text-center text-[0.76rem] leading-relaxed text-[var(--app-muted)]">
            {GROUP.closed}
          </p>
          <button
            type="button"
            onClick={() => go('circle')}
            className="text-[0.76rem] font-semibold text-[var(--gr-terra-ink)] underline-offset-4 hover:underline"
          >
            How the circle works →
          </button>
        </div>
      </Panel>

      {/* ---- what you said you'd do, and how eight weeks have gone -------- */}
      <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        <Panel className="p-6 sm:p-7">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <Eyebrow>from Dr. Osei</Eyebrow>
              <PanelHead className="mt-1.5">Between-session work</PanelHead>
            </div>
            <p className="flex-none text-right">
              <span className={`${SERIF} text-[1.6rem] leading-none text-[var(--app-ink)]`}>
                {done.length}
                <span className="text-[1.05rem] text-[var(--app-dim)]">/{TASKS.length}</span>
              </span>
              <span className="mt-1 block text-[0.7rem] text-[var(--app-muted)]">done</span>
            </p>
          </div>

          {/* One segment per task rather than a filled bar: three things were
              asked for and two are finished, which is a count, not a score. */}
          <ul aria-hidden="true" className="mt-4 flex gap-1.5">
            {TASKS.map((t) => (
              <li
                key={t.id}
                className={`h-[5px] flex-1 rounded-full ${
                  t.done ? 'bg-[var(--gr-green)]' : 'bg-[rgb(26_24_20/0.1)]'
                }`}
              />
            ))}
          </ul>

          <ul className="mt-4 flex flex-col">
            {done.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-3 border-b border-[var(--gr-line)] py-3"
              >
                <Tick done />
                <span className="flex-1 text-[0.82rem] text-[var(--app-muted)] line-through decoration-[rgb(26_24_20/0.3)]">
                  {t.title}
                </span>
                <span className={`${MONO} text-[0.62rem] text-[var(--app-dim)]`}>{t.when}</span>
              </li>
            ))}
            {open.map((t) => (
              <li key={t.id} className="mt-2">
                <Sand className="flex items-center gap-3 p-3.5">
                  <Tick done={false} />
                  <span className="flex-1">
                    <span className="block text-[0.82rem] font-semibold text-[var(--app-ink)]">
                      {t.title}
                    </span>
                    {t.note && (
                      <span className="mt-0.5 block text-[0.72rem] text-[var(--app-muted)]">
                        {t.note}
                      </span>
                    )}
                  </span>
                  <span className={`${MONO} flex-none text-[0.62rem] text-[var(--gr-terra-ink)]`}>
                    {t.when}
                  </span>
                </Sand>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => go('tasks')}
            className="mt-5 self-start text-[0.8rem] font-semibold text-[var(--gr-terra-ink)] underline-offset-4 hover:underline"
          >
            Open task space →
          </button>
        </Panel>

        <Panel className="p-6 sm:p-7">
          <Eyebrow>{PROGRESS.eyebrow}</Eyebrow>
          <PanelHead className="mt-1.5">{PROGRESS.heading}</PanelHead>

          {/* The figure and its caption are one statement: the number is the
              member's own weekly check-in, and the line under it says so
              rather than leaving a bare percentage to be read as a mark. */}
          <div className="mt-5 flex flex-wrap items-end gap-4">
            <p>
              <span className={`${SERIF} text-[2.4rem] leading-none text-[var(--app-ink)]`}>
                {PROGRESS.figure}
                <span className="text-[1.3rem] text-[var(--app-dim)]">{PROGRESS.unit}</span>
              </span>
              <span className="mt-1.5 block max-w-[140px] text-[0.72rem] leading-snug text-[var(--app-muted)]">
                {PROGRESS.caption}
              </span>
            </p>
            <Sparkline />
          </div>

          <Rule className="my-5" />

          <div className="flex items-center gap-3.5">
            <ul aria-hidden="true" className="flex gap-1">
              {Array.from({ length: 8 }, (_, i) => (
                <li
                  key={i}
                  className={`h-[26px] w-[13px] rounded-[4px] ${
                    i < 7
                      ? 'bg-[var(--gr-terra)]'
                      : 'border border-dashed border-[rgb(26_24_20/0.18)] bg-[rgb(26_24_20/0.06)]'
                  }`}
                />
              ))}
            </ul>
            <p className="text-[0.76rem] leading-snug text-[var(--app-muted)]">
              {PROGRESS.run}
              <br />
              <span className="text-[var(--app-ink)]">{PROGRESS.aside}</span>
            </p>
          </div>

          <Sand className="mt-5 p-4">
            <Eyebrow>latest note from Dr. Osei</Eyebrow>
            <Quote size="text-[0.94rem]" className="mt-2">{LATEST_NOTE}</Quote>
          </Sand>

          <button
            type="button"
            onClick={() => go('reports')}
            className="mt-4 self-start text-[0.8rem] font-semibold text-[var(--gr-terra-ink)] underline-offset-4 hover:underline"
          >
            See full report →
          </button>
        </Panel>
      </div>

      {/* ---- rooms with a seat, kept below the room you are in ------------ */}
      <Panel className="p-6 sm:p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <PanelHead>Groups with an opening</PanelHead>
            <p className="mt-1.5 max-w-[52ch] text-[0.76rem] text-[var(--app-muted)]">
              {SHORTLIST_NOTE}
            </p>
          </div>
          <button
            type="button"
            onClick={() => go('find')}
            className="text-[0.76rem] font-semibold text-[var(--gr-terra-ink)] underline-offset-4 hover:underline"
          >
            Browse all 24 →
          </button>
        </div>

        <ul className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {MATCHES.map((m) => (
            <li key={m.id}>
              <Sand className="flex h-full flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <Eyebrow tone={m.urgent ? 'terra' : 'green'}>{m.seats}</Eyebrow>
                  <span className={`${MONO} text-[0.6rem] text-[var(--app-dim)]`}>
                    {m.status.split(' · ')[0]}
                  </span>
                </div>
                <h4
                  className={`${SERIF} mt-3 text-[1.05rem] font-normal leading-snug text-[var(--app-ink)]`}
                >
                  {m.title}
                </h4>
                <p className="mt-3 flex items-center gap-2 text-[0.78rem] text-[var(--app-muted)]">
                  <TherapistDot size={20} colour={m.colour} />
                  {m.therapist}
                  {m.continues && <span className="text-[var(--app-dim)]">· your therapist</span>}
                </p>
                <Rule className="my-3.5" />
                <p className="flex-1 text-[0.74rem] leading-relaxed text-[var(--app-muted)]">
                  {m.schedule}
                  <br />
                  {m.shape}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`${m.continues ? PILL_TERRA : PILL_SOLID} min-h-9 px-4 text-[0.76rem]`}
                  >
                    {m.action ?? 'Request a seat'}
                  </button>
                  <button
                    type="button"
                    onClick={() => go('find')}
                    className={`${PILL_QUIET} min-h-9 px-3.5 text-[0.76rem]`}
                  >
                    Details
                  </button>
                </div>
              </Sand>
            </li>
          ))}
        </ul>
      </Panel>

      {/* ---- and the way out of the shortlist entirely -------------------- */}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-[20px] bg-[image:var(--app-dark)] p-7 text-[var(--app-on-dark)]">
          <Eyebrow tone="onDark">bring your own people</Eyebrow>
          <h3
            className={`${SERIF} mt-2.5 max-w-[22ch] text-[1.35rem] font-normal leading-snug`}
          >
            Form a group and hire a therapist to lead it
          </h3>
          <p className="mt-3 max-w-[46ch] text-[0.78rem] leading-relaxed text-[var(--app-on-dark-soft)]">
            {OWN_GROUP.blurb}
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => go('find')}
              className="inline-flex min-h-10 items-center rounded-full bg-[var(--app-on-dark)] px-5 text-[0.8rem] font-medium text-[var(--app-ink)] transition-opacity hover:opacity-90"
            >
              Start a group
            </button>
            <button
              type="button"
              onClick={() => go('find')}
              className="inline-flex min-h-10 items-center rounded-full border border-[rgb(244_241_234/0.28)] px-5 text-[0.8rem] transition-colors hover:bg-[var(--app-on-dark-fill)]"
            >
              See therapists
            </button>
          </div>
        </section>

        <Panel className="p-6 sm:p-7">
          <Eyebrow>available for private groups</Eyebrow>
          <ul className="mt-3">
            {HIRE.map((h, i) => (
              <li
                key={h.id}
                className={`flex flex-wrap items-center gap-3 py-3 ${
                  i < HIRE.length - 1 ? 'border-b border-[var(--gr-line)]' : ''
                }`}
              >
                <span
                  aria-hidden="true"
                  className="h-10 w-10 flex-none rounded-[10px] bg-[var(--gr-sand)] bg-[repeating-linear-gradient(-45deg,rgb(26_24_20/0.09)_0_5px,transparent_5px_10px)]"
                />
                <span className="min-w-[10rem] flex-1">
                  <span className="block text-[0.82rem] font-semibold text-[var(--app-ink)]">
                    {h.name}
                  </span>
                  <span className="mt-0.5 block text-[0.72rem] text-[var(--app-muted)]">
                    {h.practice}
                  </span>
                </span>
                <button type="button" className={`${PILL_QUIET} min-h-9 px-4 text-[0.74rem]`}>
                  Invite
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  )
}

/** Eight weeks of the member's own weekly check-in, at a glance. Unlabelled
    on purpose — the readable version is on the reports screen, and a line
    this small can only honestly say "there is a shape here". */
function Sparkline() {
  return (
    <svg viewBox="0 0 210 62" width="210" height="62" aria-hidden="true" className="max-w-full">
      <line x1="0" y1="60" x2="210" y2="60" stroke="var(--gr-line)" strokeWidth="1" />
      <polyline
        points="0,10 30,16 60,12 90,28 120,24 150,40 180,36 210,48"
        fill="none"
        stroke="var(--gr-green)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="210" cy="48" r="4" fill="var(--gr-green)" />
    </svg>
  )
}
