import { useState } from 'react'
import { LABEL, PATH } from '../../../pages/dashboard/tokens'
import { Glyph } from '../../../pages/dashboard/ui'

/* ============================================================================
   The two enforcement states.

   `SafetyRead` above these says what was noticed. Neither of these repeats it.
   What they carry is the part that differs by surface: whether the member may
   send anyway, and what to do if the check is wrong about them.

   Keeping them as two components rather than one with a boolean is deliberate.
   They are not the same panel in two colours — one is advice sitting beside a
   working button, the other is a closed door with a way through it. Collapsing
   them into a flag is how a suggestion quietly acquires the copy of a refusal.
   ========================================================================= */

/* ------------------------------------------------------------- advisory -- */

/** A new post that tripped a reword category.
 *
 * The member is told, and then left alone. §5.3 says the writer is told what
 * was noticed, not overruled by it — and on a first post that matters more
 * than anywhere else, because the bleakest posts here are the honest ones. */
export function RewriteSuggestion({ guidance }: { guidance: string }) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) {
    return (
      <p className="mt-2.5 text-[0.74rem] leading-relaxed text-[var(--app-faint)]">
        Suggestion set aside. Post it whenever you are ready.
      </p>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="cm-rise mt-3 rounded-[14px] border border-[var(--cm-gold-edge)] bg-[var(--cm-gold-wash)] px-4 py-3.5"
    >
      <p
        className={`${LABEL} flex items-center gap-1.5 tracking-[0.14em] text-[var(--app-gold-ink)]`}
      >
        <Glyph d={PATH.pen} size={12} />
        A suggestion, not a block
      </p>

      <p className="mt-2 text-[0.8rem] leading-relaxed text-[var(--app-body)]">
        <span className="font-semibold">You can post this as written.</span> {guidance}
      </p>

      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="mt-2.5 min-h-9 text-[0.74rem] font-semibold text-[var(--app-gold-ink)] underline underline-offset-4 transition-colors hover:text-[var(--app-ink)]"
      >
        Post it as it is
      </button>
    </div>
  )
}

/* ----------------------------------------------------------------- gate -- */

/** A reply that tripped a reword category.
 *
 * This one does stop. The words are aimed at somebody already having a hard
 * time, so they do not land until they change.
 *
 * Three things the panel has to do, and the third is the one usually missed:
 * say plainly that it is stopped, say what would change it, and give a way
 * through when the check is wrong. A gate with no appeal leaves a false
 * positive with two options — give up, or learn to word around the filter —
 * and the second is worse for everyone than the reply would have been. */
export function RewriteGate({
  guidance,
  recipient,
  dark = false,
}: {
  /** the rewrite guidance, from the server when it answered and the on-device
      check when it did not */
  guidance: string
  /** whose post this is a reply to, so the stake is a person and not a rule */
  recipient?: string
  dark?: boolean
}) {
  const [appealed, setAppealed] = useState(false)

  if (appealed) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`cm-rise mt-3 rounded-[14px] border px-4 py-3.5 ${
          dark
            ? 'border-[rgb(244_241_234/0.2)] bg-[rgb(244_241_234/0.06)]'
            : 'border-[var(--cm-edge)] bg-[var(--cm-sunken)]'
        }`}
      >
        <p
          className={`${LABEL} flex items-center gap-1.5 tracking-[0.14em] ${
            dark ? 'text-[var(--app-gold-lit)]' : 'text-[var(--cm-hold-ink)]'
          }`}
        >
          <Glyph d={PATH.check} size={12} />
          Sent for a human read
        </p>
        <p
          className={`mt-2 text-[0.8rem] leading-relaxed ${
            dark ? 'text-[var(--app-on-dark-soft)]' : 'text-[var(--app-body)]'
          }`}
        >
          A moderator will look at this within a day. Your draft is kept as you wrote it — you do
          not need to stay on this screen, and nothing is sent to {recipient ?? 'them'} in the
          meantime.
        </p>
        <button
          type="button"
          onClick={() => setAppealed(false)}
          className={`mt-2.5 min-h-9 text-[0.74rem] font-semibold underline underline-offset-4 ${
            dark ? 'text-[var(--app-gold-lit)]' : 'text-[var(--app-ink)]'
          }`}
        >
          Go back and edit it instead
        </button>
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`cm-rise mt-3 rounded-[14px] border px-4 py-3.5 ${
        dark
          ? 'border-[#e8a88e] bg-[rgb(168_72_28/0.16)]'
          : 'border-[var(--cm-alert-edge)] bg-[var(--cm-alert-bg)]'
      }`}
    >
      <p
        className={`${LABEL} flex items-center gap-1.5 tracking-[0.14em] ${
          dark ? 'text-[#e8a88e]' : 'text-[var(--cm-alert-ink)]'
        }`}
      >
        <Glyph d={PATH.shield} size={12} />
        Not sent yet
      </p>

      <p
        className={`mt-2 text-[0.82rem] font-semibold leading-relaxed ${
          dark ? 'text-[var(--app-on-dark)]' : 'text-[var(--app-ink)]'
        }`}
      >
        This reply needs a rewrite before it can go
        {recipient ? ` to ${recipient}` : ''}.
      </p>

      <p
        className={`mt-1.5 text-[0.8rem] leading-relaxed ${
          dark ? 'text-[var(--app-on-dark-soft)]' : 'text-[var(--app-body)]'
        }`}
      >
        {guidance}
      </p>

      {/* The reason the rule is stricter here than on a post of your own. Said
          once, in the place where somebody meets it, rather than in a policy
          page nobody opens. */}
      <p
        className={`mt-2.5 border-t pt-2.5 text-[0.74rem] leading-relaxed ${
          dark
            ? 'border-[rgb(244_241_234/0.18)] text-[var(--app-on-dark-dim)]'
            : 'border-[rgb(140_61_24/0.18)] text-[var(--app-faint)]'
        }`}
      >
        Your own posts are never held for wording — you can say them however they come out. Replies
        are, because they arrive with somebody else already having a hard day.
      </p>

      <button
        type="button"
        onClick={() => setAppealed(true)}
        className={`mt-2.5 min-h-9 text-[0.74rem] font-semibold underline underline-offset-4 transition-colors ${
          dark ? 'text-[#e8a88e] hover:text-[var(--app-on-dark)]' : 'text-[var(--cm-alert-ink)] hover:text-[var(--app-ink)]'
        }`}
      >
        I think this is wrong — ask for a human read
      </button>
    </div>
  )
}
