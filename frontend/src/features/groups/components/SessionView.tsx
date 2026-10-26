import { useState } from 'react'
import { CHAT, GROUP, IN_SESSION_TASKS, SEATS, SESSION } from '../../../content/groups'
import { ROOM_COUNT, useSpeakingCycle } from '../model/session'
import { useMyGroupName } from '../model/groupName'
import { useMyLook } from '../model/myLook'
import { Avatar } from './Avatar'
import { lookOf, ParticipantCircle, SeatMedia } from './ParticipantCircle'
import {
  Eyebrow,
  MONO,
  PILL_QUIET,
  Quote,
  Sand,
  SERIF,
} from './parts'

/* ============================================================================
   1d — the live session. The group is the interface.

   Three zones, all of them in view at once: who has the floor, the circle, and
   what the room is typing. That is the whole argument of the screen — you can
   watch the person speaking, see the shape of the group around them, and read
   the chat without any of the three covering another. A grid of equal tiles
   can show the first and the third but never the second.

   The circle is given the middle and the most space because it is the only
   part that carries meaning no list could: who is here, who is talking, and
   the fact that the seven seats stay seven whatever happens.
   ========================================================================= */

const CONTROLS = [
  { id: 'mic', label: 'Mic on', live: true },
  { id: 'cam', label: 'Camera off', live: false },
  { id: 'hand', label: 'Raise hand', live: false },
]

export function SessionView({
  onLeave,
  onOpenTasks,
}: {
  /** back out to the dashboard — the only way off this screen */
  onLeave: () => void
  onOpenTasks: () => void
}) {
  const [tab, setTab] = useState<'group' | 'private'>('group')

  /* One value for who has the floor. The video panel, the circle, and the
     queue all read it, so the screen cannot say one name and show another. */
  const speaking = useSpeakingCycle(true)
  const speaker = speaking >= 0 ? SEATS[speaking] : null
  const myName = useMyGroupName(GROUP.id)


  return (
    <div className="gr-room gr-session-full">
      {/* ---- the bar that says what is happening and how to leave -------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--gr-line)] bg-[var(--gr-paper)] px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-3.5">
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="gr-live-dot h-[7px] w-[7px] rounded-full bg-[var(--gr-terra)]"
            />
            <span
              className={`${MONO} text-[0.6rem] font-medium uppercase tracking-[0.12em] text-[var(--gr-terra-ink)]`}
            >
              live · {SESSION.elapsed}
            </span>
          </span>
          <span aria-hidden="true" className="h-4 w-px bg-[var(--gr-line-strong)]" />
          <span className={`${SERIF} text-[1.05rem] text-[var(--app-ink)]`}>{GROUP.title}</span>
          <span className="text-[0.74rem] text-[var(--app-muted)]">
            {GROUP.position.toLowerCase()} · 90 min
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {CONTROLS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`inline-flex min-h-9 items-center gap-2 rounded-full bg-[var(--gr-sand)] px-3.5 text-[0.76rem] transition-colors hover:bg-[rgb(26_24_20/0.08)] ${
                c.live ? 'text-[var(--app-ink)]' : 'text-[var(--app-muted)]'
              }`}
            >
              {c.live && (
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--gr-green)]" />
              )}
              {c.label}
            </button>
          ))}
          {/* Leaving is always one button away and never buried behind a
              confirm — someone who needs to step out needs to step out. */}
          <button
            type="button"
            onClick={onLeave}
            aria-label="Step out of the session and back to your dashboard"
            className="inline-flex min-h-9 items-center rounded-full border border-[var(--gr-terra-edge)] px-5 text-[0.76rem] text-[var(--gr-terra-ink)] transition-colors hover:bg-[var(--gr-terra-wash)]"
          >
            Step out
          </button>
        </div>
      </div>

      <div className="gr-stage">
        {/* ---- the circle, on half the window ---------------------------- */}
        <div className="flex flex-col items-center gap-3 bg-[var(--gr-sand)] px-5 py-4">
          {/* The question sits down off the top rather than against the bar —
              it is the thing the hour is about, and pinned to the header it
              read as a caption on the chrome above it. */}
          {/* The measure was 42ch, which landed within a word of the question's
              own length — so it broke to two lines, and any small change in
              the column flipped it back to one. It is a single sentence and it
              reads as one line; the cap is now wide enough that it stays one
              wherever there is room, and `text-balance` splits it evenly
              rather than orphaning a word when there is not. */}
          <div className="max-w-[58ch] flex-none pt-6 text-center sm:pt-10">
            <Eyebrow>this week’s question</Eyebrow>
            <Quote
              size="text-[1.32rem]"
              leading="leading-snug"
              className="mt-3 text-balance"
            >
              {GROUP.question}
            </Quote>
          </div>

          {/* As large as the space it is actually given, measured against that
              space rather than the window — see `.gr-ring-slot`. 1.0333 is the
              band the names hang into, so the width is chosen such that the
              whole box including them fits the slot's height. */}
          <div className="gr-ring-slot flex min-h-0 w-full flex-1 items-center justify-center">
            <ParticipantCircle
              size="min(100cqw, calc(100cqh / 1.0333))"
              speaking={speaking}
            />
          </div>

          <p className="flex flex-none items-center gap-2 rounded-full bg-[var(--gr-paper)] px-4 py-2 text-center text-[0.72rem] text-[var(--app-muted)]">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 flex-none rounded-full bg-[var(--gr-green)]"
            />
            {SESSION.circleNote}
          </p>
        </div>

        {/* ---- the camera, and what was set in the room ------------------ */}
        <div className="gr-stage-mid border-y border-[var(--gr-line)] lg:border-x lg:border-y-0">
          <section className="flex flex-col p-5">
            <div className="flex flex-none items-baseline justify-between gap-2">
              <Eyebrow>{speaker ? 'live video' : 'the room'}</Eyebrow>
              <span className="text-[0.66rem] text-[var(--app-muted)]">{ROOM_COUNT}</span>
            </div>

            {/* One face at a time — whoever the middle of the room is holding.
                A grid of eight thumbnails here would be the circle again,
                worse, and would leave nothing to look at while the room is
                quiet except eight people not talking. */}
            <div
              className={`gr-video-tile relative mt-2.5 min-h-0 flex-1 overflow-hidden rounded-[16px] ${
                speaker ? 'border-[2.5px] border-[var(--gr-terra)]' : ''
              }`}
            >
              {speaker ? (
                <>
                  <SeatMedia seat={speaker} />

                  <span className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-[rgb(30_26_20/0.55)] px-2.5 py-1">
                    <span
                      aria-hidden="true"
                      className="gr-live-dot h-[5px] w-[5px] rounded-full bg-[oklch(0.68_0.19_25)]"
                    />
                    <span
                      className={`${MONO} text-[0.55rem] uppercase tracking-[0.12em] text-[#fbf8f2]`}
                    >
                      speaking
                    </span>
                  </span>

                  {/* Their mic, not yours — the one thing about a speaker you
                      cannot read off their face. */}
                  <span
                    aria-hidden="true"
                    className="absolute right-2.5 top-2.5 grid h-5 w-5 place-items-center rounded-full bg-[rgb(30_26_20/0.4)]"
                  >
                    <span className="h-2 w-2 rounded-full bg-[var(--gr-green)]" />
                  </span>

                  <span className="absolute inset-x-0 bottom-0 bg-[linear-gradient(transparent,rgb(30_26_20/0.78))] px-4 pb-4 pt-10">
                    <span className="block text-[1.02rem] font-medium text-[#fdfcf8]">
                      {speaker.role === 'you' ? `${myName} · you` : speaker.name}
                    </span>
                    <span className="block text-[0.7rem] text-[rgb(253_252_248/0.74)]">
                      {speaker.role === 'therapist'
                        ? 'leading the session'
                        : `has the floor · ${SESSION.speaker.spoken.replace(' this session', '')}`}
                    </span>
                    <Waveform live />
                  </span>
                </>
              ) : (
                <span
                  className={`${MONO} flex h-full w-full items-center justify-center rounded-[16px] bg-[var(--gr-sand)] text-[0.6rem] uppercase tracking-[0.12em] text-[var(--app-dim)]`}
                >
                  quiet · nobody speaking
                </span>
              )}
            </div>

            <p className="mt-3 flex-none text-[0.74rem] leading-relaxed text-[var(--app-muted)]">
              Up next by hand:{' '}
              {SESSION.queue.map((n, i) => (
                <span key={n}>
                  <span className="text-[var(--app-ink)]">{n}</span>
                  {i < SESSION.queue.length - 1 ? ', then ' : '.'}
                </span>
              ))}
            </p>
          </section>

          <section className="flex flex-col border-t border-[var(--gr-line)] p-5">
            <div className="flex flex-none items-baseline justify-between gap-2">
              <Eyebrow>assigned in session</Eyebrow>
              <span className={`${MONO} text-[0.6rem] text-[var(--gr-terra-ink)]`}>2 NEW</span>
            </div>
            <ul className="mt-3 flex flex-col gap-2.5">
              {IN_SESSION_TASKS.map((t) => (
                <li key={t.id}>
                  <Sand
                    className={`p-3.5 ${t.mine ? 'border border-[var(--gr-terra-edge)]' : ''}`}
                  >
                    <p className="text-[0.78rem] font-semibold leading-snug text-[var(--app-ink)]">
                      {t.title}
                    </p>
                    <p
                      className={`mt-1 text-[0.7rem] ${
                        t.mine ? 'text-[var(--gr-terra-ink)]' : 'text-[var(--app-muted)]'
                      }`}
                    >
                      {t.scope}
                    </p>
                  </Sand>
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-4">
              <button
                type="button"
                onClick={onOpenTasks}
                className="text-[0.76rem] font-semibold text-[var(--gr-terra-ink)] underline-offset-4 hover:underline"
              >
                Open task space →
              </button>
              <p className="mt-1.5 text-[0.68rem] leading-snug text-[var(--app-dim)]">
                Tasks stay here after the session ends.
              </p>
            </div>
          </section>
        </div>

        {/* ---- what the room is typing ----------------------------------- */}
        <div className="flex flex-col bg-[var(--gr-paper)]">
          <div className="flex gap-4 border-b border-[var(--gr-line)] px-5 pt-4">
            {(
              [
                { id: 'group', label: 'Chat' },
                { id: 'private', label: 'Private to Dr. Osei' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                aria-current={tab === t.id ? 'true' : undefined}
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 pb-2.5 text-[0.76rem] transition-colors ${
                  tab === t.id
                    ? 'border-[var(--gr-terra)] font-semibold text-[var(--app-ink)]'
                    : 'border-transparent text-[var(--app-muted)] hover:text-[var(--app-ink)]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* The transcript sits on the composer, newest line last, the way
              every live conversation reads. Anchored to the top it left a
              third of the column empty between the last thing anyone said
              and the box you say the next thing in. */}
          <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-5">
            <p
              className={`${MONO} text-center text-[0.6rem] uppercase tracking-[0.09em] text-[var(--app-dim)]`}
            >
              {tab === 'group'
                ? SESSION.chatNote
                : 'only Dr. Osei sees this, during and after'}
            </p>

            {tab === 'group' ? (
              <>
                <ul className="mt-auto flex flex-col gap-3.5">
                  {CHAT.map((line) => (
                    <ChatBubble key={line.id} line={line} />
                  ))}
                </ul>
                <p className="text-center text-[0.72rem] italic text-[var(--app-dim)]">
                  {SESSION.typing}
                </p>
              </>
            ) : (
              <p className="mt-auto text-[0.78rem] leading-relaxed text-[var(--app-muted)]">
                Nothing sent yet. A line here reaches Dr. Osei only — the group is never told
                that you wrote one.
              </p>
            )}
          </div>

          <div className="border-t border-[var(--gr-line)] px-5 pb-5 pt-3.5">
            <p className="flex items-center gap-2.5 rounded-full bg-[var(--gr-sand)] px-4 py-3 text-[0.78rem] text-[var(--app-dim)]">
              <span className="flex-1">
                {tab === 'group' ? 'Say something to the group…' : 'Say something to Dr. Osei…'}
              </span>
              <span className={`${MONO} text-[0.62rem]`}>↵</span>
            </p>
            {tab === 'group' && (
              <ul className="mt-2.5 flex flex-wrap gap-2">
                {SESSION.quickReplies.map((q) => (
                  <li key={q}>
                    <button
                      type="button"
                      className={`${PILL_QUIET} min-h-8 px-3 text-[0.7rem] text-[var(--app-muted)]`}
                    >
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** One line of chat. The therapist's is tinted and named as hers, the
    member's own is reversed — nobody has to work out who said what. */
function ChatBubble({ line }: { line: (typeof CHAT)[number] }) {
  const seat = SEATS.find((s) => s.id === line.seat)
  const myLook = useMyLook()
  const look = seat && lookOf(seat, myLook)
  const mine = line.from === 'you'
  const myName = useMyGroupName(GROUP.id)
  const therapist = line.from === 'therapist'

  return (
    <li className={`flex gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
      {/* Big enough that the character is legible, not just a coloured dot —
          in a room where a drawn face is the only identity anyone has, the
          face beside the line is how you know who is talking. */}
      {look ? (
        <Avatar look={look} size={34} className="mt-0.5" />
      ) : (
        <span
          aria-hidden="true"
          className="mt-0.5 h-[34px] w-[34px] flex-none rounded-full"
          style={{
            background: 'var(--gr-terra)',
            backgroundImage:
              'repeating-linear-gradient(-45deg, rgb(255 255 255 / 0.18) 0 4px, transparent 4px 8px)',
            boxShadow: '0 0 0 2px var(--gr-terra-ring)',
          }}
        />
      )}
      <div className={mine ? 'text-right' : ''}>
        <p
          className={`mb-1 text-[0.68rem] ${
            therapist ? 'text-[var(--gr-terra-ink)]' : 'text-[var(--app-muted)]'
          }`}
        >
          {mine ? `You · ${myName}` : line.who}
        </p>
        <p
          className={`px-3 py-2 text-left text-[0.78rem] leading-snug ${
            mine
              ? 'rounded-[12px_3px_12px_12px] bg-[var(--app-ink)] text-[var(--app-rail)]'
              : therapist
                ? 'rounded-[3px_12px_12px_12px] bg-[var(--gr-terra-wash)] text-[var(--app-ink)]'
                : 'rounded-[3px_12px_12px_12px] bg-[var(--gr-sand)] text-[var(--app-ink)]'
          }`}
        >
          {line.body}
        </p>
      </div>
    </li>
  )
}

/* The roster strip is gone. It listed the room in 34px circles beside a circle
   that lists the room at four times the size — the same fact twice, and the
   small copy was the one nobody could read. */

/** The speaker's level, over their own picture.

    Illustrative: a real meter feeds the peaks and nothing else about the strip
    changes. Each bar carries its own peak, period and offset so the row moves
    like a voice — uneven, overlapping, never in step. Flat and still when
    nobody is talking, because a meter showing sound in a silent room is the
    one thing this strip must not do. */
function Waveform({ live }: { live: boolean }) {
  const bars = [40, 74, 56, 96, 66, 34, 82, 46, 70, 30, 58, 86]

  return (
    <ul aria-hidden="true" className="mt-4 flex h-7 items-end gap-[3px]">
      {bars.map((peak, i) => (
        <li
          key={i}
          className={`flex-1 rounded-[2px] ${live ? 'gr-bar' : 'transition-[height] duration-300'}`}
          style={
            live
              ? ({
                  height: '16%',
                  '--peak': `${peak}%`,
                  /* Periods that do not divide into each other, so the row
                     never falls into a repeating pattern the eye can catch. */
                  '--dur': `${520 + ((i * 137) % 380)}ms`,
                  '--delay': `${(i * 90) % 700}ms`,
                  background: peak > 90 ? '#fdfcf8' : 'rgb(253 252 248 / 0.62)',
                } as React.CSSProperties)
              : { height: '12%', background: 'rgb(253 252 248 / 0.4)' }
          }
        />
      ))}
    </ul>
  )
}
