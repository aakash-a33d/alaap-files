import { useState } from 'react'
import { TASK_SPACE } from '../../../content/groups'
import {
  Eyebrow,
  MONO,
  PILL_QUIET,
  PILL_TERRA,
  Quote,
  Sand,
  SERIF,
  TherapistDot,
  Tick,
  Title,
} from './parts'
import type { GroupView } from './views'

/* ============================================================================
   1j — the task space. The list on the left, the actual doing on the right.

   Most therapy homework dies in the gap between being told about it and having
   somewhere to do it. So the writing surface is on the same screen as the
   list, already open, with the therapist's own brief above it — there is no
   step between reading what was asked and starting.

   Sharing is two separate switches, both off by default in the sense that
   matters: the group never sees the text unless the member turns it on, and
   the member is told in a sentence what each switch actually causes. Nothing
   here is scored, and the screen says so next to the button that finishes it,
   because "mark as done" is the moment somebody wonders what it counts for.
   ========================================================================= */

export function TaskSpaceView({ go }: { go: (v: GroupView) => void }) {
  const [sharing, setSharing] = useState<Record<string, boolean>>(
    Object.fromEntries(TASK_SPACE.sharing.map((s) => [s.id, s.on])),
  )
  const t = TASK_SPACE.open

  return (
    <div className="overflow-hidden rounded-[20px] bg-[var(--app-ground)] shadow-[var(--gr-lift)] lg:grid lg:grid-cols-[340px_minmax(0,1fr)]">
      {/* ---- everything you have been asked for -------------------------- */}
      <div className="border-b border-[var(--gr-line)] px-6 py-6 lg:border-b-0 lg:border-r">
        <Title size="text-[1.4rem]">Your task space</Title>

        <div className="mt-3.5 flex items-center gap-3">
          <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-[rgb(26_24_20/0.1)]">
            <div
              className="h-full rounded-full bg-[var(--gr-green)]"
              style={{ width: `${Math.round((TASK_SPACE.done / TASK_SPACE.total) * 100)}%` }}
            />
          </div>
          <span className={`${MONO} text-[0.64rem] text-[var(--app-dim)]`}>
            {TASK_SPACE.done} / {TASK_SPACE.total}
          </span>
        </div>

        <Eyebrow tone="terra" className="mt-6">
          due before tuesday
        </Eyebrow>
        <article className="mt-2.5 rounded-[14px] border-[1.5px] border-[var(--gr-terra)] bg-[var(--gr-paper)] p-4">
          <h3 className="text-[0.84rem] font-semibold leading-snug text-[var(--app-ink)]">
            {t.title}
          </h3>
          <p className="mt-1.5 text-[0.72rem] text-[var(--app-muted)]">{t.assigned}</p>
          <p className="mt-2.5 flex items-center gap-2">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--gr-terra)]" />
            <span className={`${MONO} text-[0.6rem] text-[var(--gr-terra-ink)]`}>{t.saved}</span>
          </p>
        </article>

        <Eyebrow className="mt-6">this week</Eyebrow>
        <article className="mt-2.5 rounded-[14px] border border-[var(--gr-line-strong)] bg-[var(--gr-paper)] p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5">
              <Tick done={false} size={18} />
            </span>
            <div>
              <h3 className="text-[0.8rem] leading-snug text-[var(--app-ink)]">
                {TASK_SPACE.groupTask.title}
              </h3>
              <p className="mt-1 text-[0.72rem] text-[var(--app-muted)]">
                {TASK_SPACE.groupTask.progress}
              </p>
            </div>
          </div>
        </article>

        <Eyebrow className="mt-6">done</Eyebrow>
        <ul className="mt-2">
          {TASK_SPACE.finished.map((f, i) => (
            <li
              key={f.id}
              className={`flex items-center gap-3 py-3 ${
                i < TASK_SPACE.finished.length - 1 ? 'border-b border-[var(--gr-line)]' : ''
              }`}
            >
              <Tick done size={17} />
              <span className="flex-1 text-[0.78rem] text-[var(--app-muted)]">{f.title}</span>
              <span className={`${MONO} text-[0.6rem] text-[var(--app-dim)]`}>{f.when}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => go('reports')}
          className="mt-5 text-[0.76rem] font-semibold text-[var(--gr-terra-ink)] underline-offset-4 hover:underline"
        >
          Task history &amp; reports →
        </button>
      </div>

      {/* ---- and the room to actually do one ----------------------------- */}
      <div className="px-6 py-7 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Eyebrow>{t.due}</Eyebrow>
            <h3
              className={`${SERIF} mt-2 max-w-[26ch] text-[clamp(1.25rem,2.4vw,1.6rem)] font-normal leading-tight text-[var(--app-ink)]`}
            >
              {t.title}
            </h3>
          </div>
          <span
            className={`${MONO} rounded-full bg-[var(--gr-sand)] px-3.5 py-2 text-[0.6rem] uppercase tracking-[0.09em] text-[var(--app-muted)]`}
          >
            private by default
          </span>
        </div>

        <Sand className="mt-5 p-5">
          <p className="flex items-center gap-2.5">
            <TherapistDot size={22} />
            <span
              className={`${MONO} text-[0.6rem] uppercase tracking-[0.1em] text-[var(--app-muted)]`}
            >
              what Dr. Osei asked for
            </span>
          </p>
          <Quote className="mt-2.5">{t.brief}</Quote>
        </Sand>

        {/* The draft as it stands. A real editor replaces the two paragraphs
            and nothing around them moves. */}
        <div className="mt-4 overflow-hidden rounded-[14px] border border-[var(--gr-line-strong)] bg-[var(--gr-paper)]">
          <div className="min-h-[210px] p-5">
            <p
              className={`${SERIF} text-[0.98rem] font-normal leading-loose text-[var(--app-ink)]`}
            >
              {t.draft}
            </p>
            <p
              className={`${SERIF} mt-2.5 text-[0.98rem] font-normal leading-loose text-[var(--app-dim)]`}
            >
              keep going…
              <span
                aria-hidden="true"
                className="ml-0.5 inline-block h-4 w-[1.5px] translate-y-[3px] bg-[var(--gr-terra)]"
              />
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--gr-line)] bg-[var(--gr-sand)] px-5 py-3">
            <span className={`${MONO} text-[0.6rem] text-[var(--app-dim)]`}>
              {t.words} WORDS · SAVED 2H AGO · ONLY YOU CAN SEE THIS
            </span>
            <span className="flex gap-3.5 text-[0.72rem] text-[var(--app-muted)]">
              <button type="button" className="hover:text-[var(--app-ink)]">
                Attach a photo
              </button>
              <button type="button" className="hover:text-[var(--app-ink)]">
                Voice note
              </button>
            </span>
          </div>
        </div>

        <ul className="mt-4 grid gap-3.5 sm:grid-cols-2">
          {TASK_SPACE.sharing.map((s) => {
            const on = sharing[s.id]
            return (
              <li key={s.id}>
                <div className="h-full rounded-[14px] border border-[var(--gr-line-strong)] bg-[var(--gr-paper)] p-4">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() => setSharing((p) => ({ ...p, [s.id]: !p[s.id] }))}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <span className="text-[0.8rem] font-semibold text-[var(--app-ink)]">
                      {s.title}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`relative h-[22px] w-[38px] flex-none rounded-full transition-colors ${
                        on ? 'bg-[var(--gr-green)]' : 'bg-[rgb(26_24_20/0.14)]'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_2px_rgb(26_24_20/0.2)] transition-[left] ${
                          on ? 'left-[18px]' : 'left-0.5'
                        }`}
                      />
                    </span>
                  </button>
                  {/* The sentence changes with the switch, because "off" and
                      "on" mean different things for each of these and a static
                      caption would be wrong half the time. */}
                  <p className="mt-2 text-[0.72rem] leading-relaxed text-[var(--app-muted)]">
                    {on === s.on
                      ? s.body
                      : s.id === 'group'
                        ? 'On — the group can read the text from Tuesday. You can turn this off again at any time before then.'
                        : 'Off — Dr. Osei sees only that you marked it done, not what you wrote.'}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-[46ch] text-[0.74rem] leading-relaxed text-[var(--app-muted)]">
            {TASK_SPACE.footnote}
          </p>
          <div className="flex flex-wrap gap-2.5">
            <button type="button" className={PILL_QUIET}>
              Save draft
            </button>
            <button type="button" className={PILL_TERRA}>
              Mark as done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
