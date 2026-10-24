import { CIRCLE_RULES, CIRCLE_STATES } from '../../../content/groups'
import { ParticipantCircle } from './ParticipantCircle'
import { Eyebrow, Panel, Title } from './parts'

/* ============================================================================
   1g — the circle, three states.

   The reason this is a screen the member can open rather than a note in a
   design file: the circle is the only part of the product whose behaviour has
   to be understood before the first session, and understanding it is what
   makes the first session survivable. Somebody who knows that their seat stays
   put while they talk, and that silence is a labelled state rather than a
   failure, walks in differently.

   Empty seats stay visible in every state. A group of seven never looks like
   six because one of them moved.
   ========================================================================= */

export function CircleView() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Title>How the circle works</Title>
        <p className="mt-2 max-w-[62ch] text-[0.82rem] leading-relaxed text-[var(--app-faint)]">
          Three states, and the rules that hold between them. Nothing here is a setting — it is
          what the room does, so you know what you are walking into.
        </p>
      </div>

      <ul className="grid gap-5 lg:grid-cols-3">
        {CIRCLE_STATES.map((s) => (
          <li key={s.id}>
            <Panel as="article" className="flex h-full flex-col items-center gap-3.5 p-6">
              <Eyebrow tone={s.tone}>{s.label}</Eyebrow>
              <ParticipantCircle size={288} speaking={s.speaking} />
              <p className="max-w-[34ch] text-center text-[0.76rem] leading-relaxed text-[var(--app-muted)]">
                {s.body}
              </p>
            </Panel>
          </li>
        ))}
      </ul>

      <Panel className="p-6 sm:p-7">
        <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {CIRCLE_RULES.map((r) => (
            <li key={r.id}>
              <Eyebrow>{r.label}</Eyebrow>
              <p className="mt-2 text-[0.76rem] leading-relaxed text-[var(--app-muted)]">
                {r.body}
              </p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
