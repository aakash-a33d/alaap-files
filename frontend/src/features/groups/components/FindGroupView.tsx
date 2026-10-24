import { useState } from 'react'
import {
  FIND_NOTE,
  HIRE,
  MATCHES,
  MATCH_FILTERS,
  MORE_MATCHES,
  OWN_GROUP,
  type Match,
} from '../../../content/groups'
import { CIRCLE_COLOURS } from '../model/avatar'
import {
  Eyebrow,
  MONO,
  Panel,
  PanelHead,
  PILL_QUIET,
  PILL_SOLID,
  SERIF,
  TherapistDot,
  Title,
  Toggle,
} from './parts'

/* ============================================================================
   1l — find a group, or start your own.

   Every card says why it is in front of you, in a sentence, in the card. A
   recommender that will not show its reasoning is asking to be trusted about
   the most consequential thing on the platform — who somebody spends an hour
   a week being honest in front of — and it has not earned that.

   The seats are drawn, joined and open, so the size of the room is a fact
   before anyone commits to it. And the panel down the right is the answer for
   the member nothing on the list fits: bring your own people, hire someone to
   lead them. Nothing is charged until a therapist accepts, which is stated
   next to the button that sends the invites.
   ========================================================================= */

export function FindGroupView() {
  const [filters, setFilters] = useState<string[]>(['6–8 members'])

  const toggle = (f: string) =>
    setFilters((p) => (p.includes(f) ? p.filter((x) => x !== f) : [...p, f]))

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Title>Groups with a seat for you</Title>
          <p className="mt-2 max-w-[62ch] text-[0.82rem] leading-relaxed text-[var(--app-faint)]">
            {FIND_NOTE}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {MATCH_FILTERS.map((f) => (
            <Toggle key={f} on={filters.includes(f)} onClick={() => toggle(f)}>
              {f}
            </Toggle>
          ))}
          <button
            type="button"
            className="inline-flex min-h-10 items-center rounded-full border border-dashed border-[var(--gr-line-strong)] px-4 text-[0.8rem] text-[var(--app-muted)] transition-colors hover:border-[var(--gr-terra-edge)]"
          >
            + filter
          </button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
        <div className="flex flex-col gap-3.5">
          {MATCHES.filter((m) => !m.continues).map((m) => (
            <MatchCard key={m.id} match={m} />
          ))}

          <Panel className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <PanelHead size="text-[1.1rem]">{MORE_MATCHES.line}</PanelHead>
              <p className="mt-1.5 text-[0.74rem] text-[var(--app-muted)]">{MORE_MATCHES.note}</p>
            </div>
            <button type="button" className={PILL_QUIET}>
              Show all
            </button>
          </Panel>
        </div>

        {/* ---- when nothing on the list fits ----------------------------- */}
        <section className="rounded-[20px] bg-[image:var(--app-dark)] p-6 text-[var(--app-on-dark)] sm:p-7">
          <Eyebrow tone="onDarkLit">{OWN_GROUP.eyebrow}</Eyebrow>
          <h3 className={`${SERIF} mt-2.5 text-[1.35rem] font-normal leading-snug`}>
            {OWN_GROUP.title}
          </h3>

          <ul className="mt-5 flex flex-col gap-3.5">
            <li>
              <Eyebrow tone="onDark">{OWN_GROUP.steps[0].label}</Eyebrow>
              <p className="mt-1.5 rounded-[11px] bg-[var(--app-on-dark-fill)] px-3.5 py-3 text-[0.82rem]">
                {OWN_GROUP.steps[0].value}
              </p>
            </li>
            <li className="flex gap-3">
              {OWN_GROUP.steps.slice(1).map((s) => (
                <span key={s.id} className="flex-1">
                  <Eyebrow tone="onDark">{s.label}</Eyebrow>
                  <span className="mt-1.5 block rounded-[11px] bg-[var(--app-on-dark-fill)] px-3.5 py-3 text-[0.82rem]">
                    {s.value}
                  </span>
                </span>
              ))}
            </li>
          </ul>

          <Eyebrow tone="onDark" className="mt-5">
            step 4 · hire a therapist to lead it
          </Eyebrow>
          <ul className="mt-2.5 flex flex-col gap-2.5">
            {HIRE.map((h) => (
              <li
                key={h.id}
                className={`flex flex-wrap items-center gap-3 rounded-[12px] p-3 ${
                  h.state === 'invited'
                    ? 'border border-[oklch(0.75_0.1_45/0.5)] bg-[rgb(244_241_234/0.07)]'
                    : 'bg-[rgb(244_241_234/0.04)]'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="h-10 w-10 flex-none rounded-[10px] bg-[rgb(244_241_234/0.08)] bg-[repeating-linear-gradient(-45deg,rgb(244_241_234/0.14)_0_5px,transparent_5px_10px)]"
                />
                <span className="min-w-[9rem] flex-1">
                  <span className="block text-[0.8rem] font-medium">{h.name}</span>
                  <span className="mt-0.5 block text-[0.7rem] text-[var(--app-on-dark-dim)]">
                    {h.practice}
                  </span>
                </span>
                {h.state === 'invited' ? (
                  <span className="rounded-full bg-[oklch(0.75_0.1_45)] px-3.5 py-1.5 text-[0.7rem] font-medium text-[#241d16]">
                    Invited
                  </span>
                ) : h.state === 'waitlist' ? (
                  <span className="rounded-full border border-[rgb(244_241_234/0.18)] px-3.5 py-1.5 text-[0.7rem] text-[rgb(244_241_234/0.5)]">
                    Waitlist
                  </span>
                ) : (
                  <button
                    type="button"
                    className="rounded-full border border-[rgb(244_241_234/0.25)] px-3.5 py-1.5 text-[0.7rem] transition-colors hover:bg-[var(--app-on-dark-fill)]"
                  >
                    Invite
                  </button>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--app-on-dark-line)] pt-4">
            <p className="max-w-[26ch] text-[0.7rem] leading-relaxed text-[var(--app-on-dark-dim)]">
              {OWN_GROUP.terms}
            </p>
            <button
              type="button"
              className="inline-flex min-h-10 items-center rounded-full bg-[var(--app-on-dark)] px-5 text-[0.8rem] font-medium text-[var(--app-ink)] transition-opacity hover:opacity-90"
            >
              Send invites
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

function MatchCard({ match: m }: { match: Match }) {
  return (
    <Panel as="article" className="grid gap-5 p-6 sm:grid-cols-[minmax(0,1fr)_190px]">
      <div>
        <p className="flex flex-wrap items-center gap-2.5">
          <span
            className={`${MONO} text-[0.6rem] font-medium uppercase tracking-[0.1em] ${
              m.urgent ? 'text-[var(--gr-terra-ink)]' : 'text-[var(--gr-green)]'
            }`}
          >
            {m.seats}
          </span>
          <span className={`${MONO} text-[0.6rem] text-[var(--app-dim)]`}>{m.status}</span>
        </p>

        <h3
          className={`${SERIF} mt-2.5 text-[1.25rem] font-normal leading-snug text-[var(--app-ink)]`}
        >
          {m.title}
        </h3>
        <p className="mt-2 max-w-[56ch] text-[0.8rem] leading-relaxed text-[var(--app-muted)]">
          {m.blurb}
        </p>

        <p className="mt-3.5 flex flex-wrap items-center gap-2 text-[0.8rem] text-[var(--app-ink)]">
          <TherapistDot size={26} colour={m.colour} />
          {m.therapist}
          <span className="text-[0.76rem] text-[var(--app-muted)]">· {m.credential}</span>
        </p>

        {/* The reason this room reached the member at all. */}
        <div className="mt-4 flex gap-3 rounded-[12px] bg-[var(--gr-sand)] p-3.5">
          <span aria-hidden="true" className="w-[3px] flex-none rounded-full bg-[var(--gr-terra)]" />
          <p className="text-[0.74rem] leading-relaxed text-[var(--app-muted)]">
            <span className="font-semibold text-[var(--app-ink)]">Why you’re seeing this:</span>{' '}
            {m.why}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 sm:border-l sm:border-[var(--gr-line)] sm:pl-5">
        {/* Seats, joined and open, at the size the room actually is. */}
        <ul aria-hidden="true" className="flex max-w-[140px] flex-wrap gap-1.5">
          {Array.from({ length: m.joined }, (_, i) => (
            <li
              key={`in-${i}`}
              className="h-[22px] w-[22px] rounded-full"
              style={{ background: CIRCLE_COLOURS[i % CIRCLE_COLOURS.length].top }}
            />
          ))}
          {Array.from({ length: m.open }, (_, i) => (
            <li
              key={`open-${i}`}
              className="h-[22px] w-[22px] rounded-full border border-dashed border-[rgb(26_24_20/0.25)]"
            />
          ))}
        </ul>
        <p className="text-[0.72rem] leading-relaxed text-[var(--app-muted)]">
          {m.joined} joined · {m.open} open
          {m.roomNote && (
            <>
              <br />
              {m.roomNote}
            </>
          )}
        </p>

        <div className="mt-auto flex flex-col gap-2 pt-3">
          <button type="button" className={PILL_SOLID}>
            {m.action ?? 'Request a seat'}
          </button>
          <button type="button" className={PILL_QUIET}>
            Read the group brief
          </button>
        </div>
      </div>
    </Panel>
  )
}
