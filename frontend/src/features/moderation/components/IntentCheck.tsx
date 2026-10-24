import { LABEL } from '../../../pages/dashboard/tokens'

/* ============================================================================
   NOT CURRENTLY WIRED IN. Kept because it may be wanted back, and because the
   reasoning below is worth more than the component.

   This asked the writer what they meant when a line read two ways — "some
   mornings I hope it will all just be over already" is either exhaustion with
   what somebody is carrying or a wish not to be here, and the two used to go to
   different places.

   It was removed from the composer when crisis handling moved entirely to the
   backend. The product rule now is that a member's own post gets no AI
   commentary of any kind: A2 reads it, sets a flag, and mediation is told if
   and only if the member publishes. Asking the question on screen is an alert,
   and an alert is the thing a post is not allowed to produce.

   What was gained: nobody writing a bleak post is interrupted to be asked
   whether they are suicidal.

   What was lost, and it is not nothing: the disambiguation itself. A2 now
   decides alone which reading applies, and when it decides wrong there is no
   longer a person in the loop to correct it — an exhausted carer flagged as at
   risk has no way to say "that is not what I meant", because they are never
   told they were flagged. That trade is deliberate; if the false-positive rate
   on the exhausted-carer register turns out to be high, this component is the
   answer, moved somewhere it does not interrupt the writing.
   ========================================================================= */

export type Intent = null | 'context' | 'self' | 'asis'

export function IntentCheck({
  intent,
  onIntent,
  dark,
}: {
  intent: Intent
  onIntent: (i: Intent) => void
  dark: boolean
}) {
  if (intent === 'self') {
    return (
      <div
        className={`cm-rise mt-3 rounded-[14px] border px-4 py-3.5 ${
          dark
            ? 'border-[var(--app-gold-lit)] bg-[rgb(224_172_92/0.14)]'
            : 'border-[var(--cm-gold-edge)] bg-[var(--cm-gold-wash)]'
        }`}
      >
        <p
          className={`${LABEL} tracking-[0.14em] ${
            dark ? 'text-[var(--app-gold-lit)]' : 'text-[var(--app-gold-ink)]'
          }`}
        >
          A person, not a thread
        </p>
        <p
          className={`mt-2 text-[0.8rem] leading-relaxed ${
            dark ? 'text-[var(--app-on-dark)]' : 'text-[var(--app-body)]'
          }`}
        >
          This posts to the wall exactly as you wrote it, and it also opens a private line to the
          safety team. Someone reads it within the hour. Saying this out loud here is the thing
          you came to do — nothing about saying it stops you posting it.
        </p>
        <button
          type="button"
          onClick={() => onIntent(null)}
          className={`mt-2.5 text-[0.74rem] font-semibold underline underline-offset-4 ${
            dark ? 'text-[var(--app-gold-lit)]' : 'text-[var(--app-gold-ink)]'
          }`}
        >
          That is not what I meant
        </button>
      </div>
    )
  }

  const choices: { id: Intent; label: string; ghost?: boolean }[] = [
    { id: 'context', label: 'I mean the situation is exhausting' },
    { id: 'self', label: 'I mean myself' },
    { id: 'asis', label: 'Leave it as written', ghost: true },
  ]

  return (
    <div
      className={`cm-rise mt-3 rounded-[14px] px-4 py-3.5 ${
        dark ? 'bg-[rgb(224_172_92/0.12)]' : 'bg-[var(--cm-gold-wash)]'
      }`}
    >
      <p
        className={`text-[0.82rem] font-semibold ${
          dark ? 'text-[var(--app-gold-lit)]' : 'text-[var(--app-gold-ink)]'
        }`}
      >
        Checking what you mean here
      </p>
      <p
        className={`mt-1.5 text-[0.78rem] leading-relaxed ${
          dark ? 'text-[var(--app-on-dark-soft)]' : 'text-[var(--app-body)]'
        }`}
      >
        This can read two ways: worn down by what you are carrying, or a wish not to be here. Both
        can be posted — but the second one opens a private line to someone rather than a public
        thread. Which is it?
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={intent === c.id}
            onClick={() => onIntent(c.id)}
            className={
              c.ghost
                ? `min-h-10 px-2 text-[0.76rem] font-medium ${
                    dark
                      ? 'text-[var(--app-on-dark-dim)] hover:text-[var(--app-on-dark)]'
                      : 'text-[var(--app-faint)] hover:text-[var(--app-ink)]'
                  }`
                : `flex min-h-10 items-center rounded-full border px-4 text-[0.76rem] font-medium transition-colors ${
                    intent === c.id
                      ? 'border-transparent bg-[var(--app-ink)] font-semibold text-[var(--app-rail)]'
                      : dark
                        ? 'border-[rgb(244_241_234/0.28)] text-[var(--app-on-dark)] hover:border-[var(--app-gold-lit)]'
                        : 'border-[var(--cm-edge-strong)] bg-[var(--cm-paper)] text-[var(--app-ink)] hover:border-[rgb(27_23_18/0.36)]'
                  }`
            }
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  )
}
