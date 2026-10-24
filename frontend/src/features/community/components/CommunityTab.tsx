import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ANON_TERMS,
  CIRCLES,
  CIRCLE_POSTS,
  CIRCLE_SIZES,
  CIRCLE_TERMS,
  COURTYARD_STATS,
  FREE_VISIBLE_PEERS,
  HOUSE_RULES,
  JOIN_REQUESTS,
  KINDS,
  PLUS_PERKS,
  QUIET_PROMPT,
  WORD_LIMIT,
  WRITING_NOW,
  suggestForCircle,
  suggestedCircles,
  type Circle,
  type CircleDoor,
  type CircleStanding,
  type JoinRequest,
  type Plan,
  type PostKind,
} from '../../../content/community'
import { useSession } from '../../auth/hooks/useSession'

/**
 * One of the member's own posts, with how many replies it drew.
 *
 * Replaces the fixture's shape, which carried `held`, `filtered` and
 * `followUps` — counts of replies withheld behind a plan limit. The server does
 * not withhold replies; it returns the ones the member may read. Keeping those
 * fields would have meant rendering a number for something that does not happen.
 */
type MyPost = {
  thread: Thread
  total: number
  visible: number
}
import { createPost, createReply } from '../api/posts'
import { write as writeJournal } from '../../journal/api/journal'
import { useCategories, useEntitlements } from '../hooks/useCommunity'
import { useOwnThreads, useThreads } from '../hooks/useThreads'
import { aiReply, type FeedReply as Reply, type FeedThread as Thread } from '../model/thread'
import {
  countWords,
  headlineFor,
  preflight,
  type Preflight,
  type Surface,
} from '../../moderation/model/preflight'
import { RewriteGate } from '../../moderation/components/RewriteState'
import { useServerCheck } from '../../moderation/model/useServerCheck'
import { type ServerSurface } from '../../moderation/api/client'
import { ApiError } from '../../../lib/api/errors'
import { DISPLAY, LABEL, PATH } from '../../../pages/dashboard/tokens'
import { Glyph, Handle } from '../../../pages/dashboard/ui'

/* ============================================================================
   The courtyard — the community workspace.

   Four sections, because four different things happen here and flattening
   them into one feed made each worse: reading what other people wrote and
   writing beside them, setting something down with no name on it at all,
   sitting in an informal room, and looking at what came back to you.

   Three rules from the architecture shape almost every decision below.

   §5.1/§5.2 — the free plan sees one AI response and two peer replies per
   post, counting sub-replies. Everything past that is accepted and stored,
   never discarded: the person who wrote the eighth reply is not told their
   reply went nowhere, because it did not. The author is told plainly how many
   are waiting. Held replies are drawn at their real size and blurred, not
   collapsed to a line, so the thing being withheld is legibly a person.

   §5.3/§6.3 — moderation is a visible product feature. Every writing surface
   on this tab runs the same on-device check on every keystroke and says what
   it noticed, in which category, with rewrite guidance and the rule it relates
   to. It never quotes the phrase that tripped it and never explains the
   threshold, because that is a lesson in evasion.

   §7.4 — nothing on this screen grades anybody. The figures count things that
   exist — replies sent, lanterns held, posts unread — and none of them reset,
   so staying away for a week costs nothing and is not reported back.
   ========================================================================= */

/* ----------------------------------------------------------------- shell -- */

type SectionId = 'feed' | 'lanterns' | 'circles' | 'mine'

const SECTIONS: { id: SectionId; label: string; blurb: string }[] = [
  { id: 'feed', label: 'The feed', blurb: 'Posts, journals and stories' },
  { id: 'lanterns', label: 'Say it anonymously', blurb: 'A fresh handle, every time' },
  { id: 'circles', label: 'Circles', blurb: 'Informal, member-run' },
  { id: 'mine', label: 'Yours', blurb: 'Your posts and what came back' },
]

/* The card shape the whole tab is built from: warm paper, a soft drop instead
   of a hard edge, and a generous radius. Kept as a string rather than a
   component so a card can also be a <button> or an <article>. */
const CARD =
  'rounded-[20px] border border-[var(--cm-edge)] bg-[var(--cm-paper)] shadow-[var(--cm-lift)]'
const MONO = 'font-[family-name:var(--font-mono)]'

const PILL_ON =
  'bg-[var(--app-ink)] font-semibold text-[var(--app-rail)] border border-transparent'
const PILL_OFF =
  'border border-[var(--cm-edge-strong)] bg-[var(--cm-paper)] font-medium text-[var(--app-muted)] hover:border-[rgb(27_23_18/0.34)]'

/** Every pill on the tab — kinds, topics, categories, the plan preview. */
function Pill({
  on,
  onClick,
  children,
  note,
  small = false,
  disabled = false,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
  /** the mono flag after the label — "PLUS" on a kind the free plan gates */
  note?: string
  small?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        small ? 'min-h-9 px-3 text-[0.72rem]' : 'min-h-10 px-4 text-[0.76rem]'
      } ${on ? PILL_ON : PILL_OFF}`}
    >
      {children}
      {note && (
        <span
          className={`${MONO} text-[0.52rem] font-medium tracking-[0.12em] ${
            on ? 'text-[var(--app-gold-lit)]' : 'text-[var(--app-gold-ink)]'
          }`}
        >
          {note}
        </span>
      )}
    </button>
  )
}

/* ------------------------------------------------------------------- nav -- */

/** The standing section list. From 1120 up each section carries its count and
    its one-line description; below that they collapse to a pill strip, because
    a vertical list of four cards would eat a third of a phone. */
function SectionNav({
  section,
  onSection,
  counts,
}: {
  section: SectionId
  onSection: (s: SectionId) => void
  counts: Record<SectionId, string>
}) {
  return (
    <nav aria-label="Community sections" className="cm-nav">
      <ul className="cm-navlist flex flex-wrap gap-2">
        {SECTIONS.map((s) => {
          const on = section === s.id
          return (
            <li key={s.id} className="min-[1120px]:w-full">
              <button
                type="button"
                aria-current={on ? 'page' : undefined}
                onClick={() => onSection(s.id)}
                className={`min-h-11 w-full rounded-full px-4 text-left text-[0.78rem] transition-colors min-[1120px]:flex min-[1120px]:flex-col min-[1120px]:rounded-[16px] min-[1120px]:px-4 min-[1120px]:py-3 ${
                  on
                    ? 'bg-[var(--app-ink)] font-semibold text-[var(--app-rail)] min-[1120px]:shadow-[var(--cm-lift-strong)]'
                    : 'border border-[var(--cm-edge-strong)] font-medium text-[var(--app-muted)] hover:bg-[rgb(27_23_18/0.05)] min-[1120px]:border-transparent'
                }`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  {s.label}
                  <span
                    className={`${MONO} hidden text-[0.56rem] font-medium tracking-[0.1em] min-[1120px]:inline ${
                      on ? 'text-[var(--app-gold-lit)]' : 'text-[var(--app-dim)]'
                    }`}
                  >
                    {counts[s.id]}
                  </span>
                </span>
                <span
                  className={`mt-1 hidden text-[0.7rem] font-normal leading-snug min-[1120px]:block ${
                    on ? 'text-[rgb(244_241_234/0.62)]' : 'text-[var(--app-faint)]'
                  }`}
                >
                  {s.blurb}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {/* The house rules are the tab's only standing instruction, and the
          third sentence is the one that matters — most of what goes wrong
          here is advice nobody asked for. */}
      <div className="mt-4 hidden border-t border-dashed border-[var(--cm-edge-strong)] pt-3.5 min-[1120px]:block">
        <h2 className={`${LABEL} tracking-[0.16em]`}>House rules</h2>
        <p className="mt-2 text-[0.74rem] leading-relaxed text-[var(--app-faint)]">{HOUSE_RULES}</p>
      </div>
    </nav>
  )
}

/* ------------------------------------------------------------- rail parts -- */

function RailCard({
  title,
  tone = 'paper',
  children,
}: {
  title: string
  tone?: 'paper' | 'dark' | 'gold'
  children: React.ReactNode
}) {
  const skin =
    tone === 'dark'
      ? 'border-transparent bg-[image:var(--app-dark)] text-[var(--app-on-dark)]'
      : tone === 'gold'
        ? 'border-[var(--cm-gold-edge)] bg-[var(--cm-gold-wash)]'
        : 'border-[var(--cm-edge)] bg-[var(--cm-paper)]'
  return (
    <section className={`rounded-[20px] border p-4 ${skin}`}>
      <h2
        className={`${LABEL} tracking-[0.16em] ${
          tone === 'dark' ? 'text-[var(--app-gold-lit)]' : ''
        } ${tone === 'gold' ? 'text-[var(--app-gold-ink)]' : ''}`}
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

/** One question a day, the same one for everybody. It seeds the composer
    rather than opening one of its own — the prompt is a way into the feed,
    not a fifth place to write. */
function PromptRail({ onUse }: { onUse: () => void }) {
  return (
    <RailCard title="Today's quiet prompt" tone="dark">
      <p className={`${DISPLAY} mt-2.5 text-[1.05rem] leading-snug`}>{QUIET_PROMPT}</p>
      <button
        type="button"
        onClick={onUse}
        className="mt-3.5 flex min-h-10 items-center justify-center rounded-full bg-[var(--app-gold-lit)] px-4 text-[0.74rem] font-semibold text-[#3a2a08] transition-opacity hover:opacity-90"
      >
        Write from this
      </button>
    </RailCard>
  )
}

function StatsRail() {
  return (
    <RailCard title="In the courtyard">
      <dl className="mt-3 flex flex-col gap-2.5">
        {COURTYARD_STATS.map((s) => (
          <div key={s.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-[0.75rem] leading-snug text-[var(--app-body)]">{s.label}</dt>
            <dd className={`${DISPLAY} flex-none text-[0.95rem] leading-none text-[var(--app-ink)]`}>
              {s.value}
            </dd>
          </div>
        ))}
      </dl>
    </RailCard>
  )
}

/** What each kind costs, from the Community Tab design's rail. Held against
    the real WORD_LIMIT table so it can never advertise a limit the composer
    does not enforce. */
function LimitsRail({ plan }: { plan: Plan }) {
  return (
    <RailCard title="What you can post">
      <dl className="mt-3 flex flex-col">
        {KINDS.map((k, i) => {
          const limit = WORD_LIMIT[k.id][plan]
          return (
            <div
              key={k.id}
              className={`flex items-baseline justify-between gap-3 py-2.5 ${
                i > 0 ? 'border-t border-[var(--cm-edge)]' : ''
              }`}
            >
              <dt className="text-[0.78rem] text-[var(--app-body)]">{k.label}</dt>
              <dd className="flex-none text-[0.76rem] font-semibold text-[var(--app-ink)]">
                {limit === null ? 'Uncapped' : `${limit.toLocaleString()} words`}
              </dd>
            </div>
          )
        })}
        {plan === 'free' && (
          <div className="flex items-baseline justify-between gap-3 border-t border-[var(--cm-edge)] py-2.5">
            <dt className="text-[0.78rem] text-[var(--app-body)]">With Interaction Plus</dt>
            <dd className="flex-none text-[0.76rem] font-semibold text-[var(--app-gold-ink)]">
              {WORD_LIMIT.journal.plus?.toLocaleString()} words
            </dd>
          </div>
        )}
      </dl>
    </RailCard>
  )
}

function PlusRail({ onOpen }: { onOpen: () => void }) {
  return (
    <RailCard title="Interaction Plus" tone="gold">
      <p className={`${DISPLAY} mt-2 text-[0.98rem] leading-snug text-[var(--app-ink)]`}>
        Read every reply you were sent.
      </p>
      <p className="mt-2 text-[0.74rem] leading-relaxed text-[var(--app-muted)]">
        Full threads, long-form up to {WORD_LIMIT.journal.plus?.toLocaleString()} words, and circles
        you can start or join.
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="mt-3.5 flex min-h-11 w-full items-center justify-center rounded-full bg-[var(--app-ink)] px-4 text-[0.76rem] font-semibold text-[var(--app-rail)] transition-opacity hover:opacity-90"
      >
        See what opens up
      </button>
    </RailCard>
  )
}

/* -------------------------------------------------------------- safety UI -- */

const VERDICT_TONE = {
  empty: { dot: 'bg-[rgb(27_23_18/0.2)]', text: 'text-[var(--app-dim)]' },
  typing: { dot: 'bg-[var(--app-dim)]', text: 'text-[var(--app-faint)]' },
  clear: { dot: 'bg-[var(--cm-live)]', text: 'text-[var(--cm-hold-ink)]' },
  caution: { dot: 'bg-[var(--app-gold)]', text: 'text-[var(--app-gold-ink)]' },
  review: { dot: 'bg-[var(--app-gold)]', text: 'text-[var(--app-gold-ink)]' },
  reword: { dot: 'bg-[var(--cm-alert)]', text: 'text-[var(--cm-alert-ink)]' },
} as const

/** The live read. One line always; the full explanation only when there is
    something to explain, because a safety feature that lectures on every
    keystroke stops being read.

    It names the category of concern and what a supportive rewrite would look
    like. It never shows the phrase that tripped it — the design mock underlines
    the matched words, but §5.3 forbids it: quoting the match is how a filter
    teaches evasion. */
function SafetyRead({ result, dark = false }: { result: Preflight; dark?: boolean }) {
  const tone = VERDICT_TONE[result.verdict]
  const c = result.concern
  const flagged = result.verdict === 'reword' || result.verdict === 'review'

  return (
    <div
      role="status"
      aria-live="polite"
      className={`mt-3 rounded-[14px] border px-3.5 py-3 ${
        dark
          ? 'border-[rgb(244_241_234/0.18)] bg-[rgb(244_241_234/0.06)]'
          : flagged
            ? 'cm-rise border-[var(--cm-alert-edge)] bg-[var(--cm-alert-bg)]'
            : 'border-[var(--cm-edge)] bg-[var(--cm-sunken)]'
      }`}
    >
      <p className={`${LABEL} tracking-[0.14em] ${dark ? 'text-[var(--app-on-dark-dim)]' : ''}`}>
        Safety read · live
      </p>

      <p
        className={`mt-2 flex items-center gap-2 text-[0.76rem] font-medium ${
          dark ? 'text-[var(--app-on-dark)]' : tone.text
        }`}
      >
        <span aria-hidden="true" className={`h-1.5 w-1.5 flex-none rounded-full ${tone.dot}`} />
        {result.headline}
      </p>

      {c && (
        <div
          className={`mt-2.5 border-t pt-2.5 ${
            dark ? 'border-[rgb(244_241_234/0.15)]' : 'border-[rgb(27_23_18/0.1)]'
          }`}
        >
          <p
            className={`${LABEL} tracking-[0.12em] ${
              dark ? 'text-[var(--app-gold-lit)]' : 'text-[var(--cm-alert-ink)]'
            }`}
          >
            {c.label}
          </p>
          <p
            className={`mt-1.5 text-[0.76rem] leading-relaxed ${
              dark ? 'text-[var(--app-on-dark-soft)]' : 'text-[var(--app-body)]'
            }`}
          >
            {c.reason}
          </p>
          <p
            className={`mt-2 text-[0.76rem] leading-relaxed ${
              dark ? 'text-[var(--app-on-dark-soft)]' : 'text-[var(--app-muted)]'
            }`}
          >
            <span className="font-semibold">Try instead: </span>
            {c.guidance}
          </p>
          <p
            className={`mt-2 text-[0.72rem] leading-relaxed ${
              dark ? 'text-[var(--app-on-dark-dim)]' : 'text-[var(--app-faint)]'
            }`}
          >
            <span className={`${LABEL} tracking-[0.12em]`}>Rule</span>{' '}
            <span className="italic">{c.rule}</span>
          </p>
        </div>
      )}

      <p
        className={`mt-2.5 text-[0.68rem] leading-relaxed ${
          dark ? 'text-[var(--app-on-dark-dim)]' : 'text-[var(--app-dim)]'
        }`}
      >
        Nothing is submitted while this is open, and only you can see it. Checked on your device by
        automated safety systems; a human moderator may review it later.
      </p>
    </div>
  )
}

/** Words written against the plan's ceiling. The burden post has no ceiling
    on any plan, so it gets a count and no bar — a meter that can never fill
    is a threat with nothing behind it. */
function WordMeter({
  words,
  limit,
  dark = false,
}: {
  words: number
  limit: number | null
  dark?: boolean
}) {
  const dim = dark ? 'text-[var(--app-on-dark-dim)]' : 'text-[var(--app-dim)]'
  if (limit === null) {
    return (
      <span className={`${LABEL} tracking-[0.1em] ${dim}`}>
        {words} {words === 1 ? 'word' : 'words'}
      </span>
    )
  }
  const over = words > limit
  const pct = Math.min(100, Math.round((words / limit) * 100))
  return (
    <div className="min-w-[130px] flex-1">
      <div
        className={`h-[5px] overflow-hidden rounded-full ${
          dark ? 'bg-[rgb(244_241_234/0.14)]' : 'bg-[var(--cm-stone)]'
        }`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-200"
          style={{
            width: `${pct}%`,
            background: over ? 'var(--cm-alert)' : 'var(--cm-live)',
          }}
        />
      </div>
      <span
        className={`${LABEL} mt-1.5 block tracking-[0.1em] ${
          over ? (dark ? 'text-[#e8a88e]' : 'text-[var(--cm-alert-ink)]') : dim
        }`}
      >
        {words.toLocaleString()} / {limit.toLocaleString()} words{over && ' · over the limit'}
      </span>
    </div>
  )
}

/* ---------------------------------------------------------- the composer -- */

/** Every place a member types on this tab uses this — but what it does splits
    cleanly in two, and the split is the product decision.

    **A member's own post.** No moderation, and no commentary. The safety read
    is not rendered, the server is not asked for a verdict, and the Post button
    is live from the first word. Nothing reads the draft at all — crisis triage
    runs server side on what actually published, which is what makes the consent
    text true: "It does not read drafts. Nothing you type and then delete leaves
    any trace." An abandoned draft never leaves this device.

    **A reply, or a message to a circle.** A1 reads it and says what it found,
    and the button does not enable until nothing is found. These words are aimed
    at somebody who is usually already having a hard day, so this is the surface
    where the check is a gate rather than a comment. A2 runs on the reply too,
    server side, on the text that actually published. */
function Composer({
  plan,
  kind = 'post',
  placeholder,
  label,
  submitLabel,
  compact = false,
  dark = false,
  onCancel,
  value,
  onValueChange,
  fieldRef,
  titled = false,
  aside,
  surface = 'post',
  recipient,
  onSubmit,
}: {
  plan: Plan
  kind?: PostKind
  placeholder: string
  label: string
  submitLabel: string
  compact?: boolean
  dark?: boolean
  onCancel?: () => void
  /** Where the words are going. A post of your own is never gated on wording;
      a reply is, because it arrives with somebody already having a hard day. */
  surface?: Surface
  /** the handle being replied to, so the gate names a person not a rule */
  recipient?: string
  /** supply both to drive the draft from outside — the quiet prompt does */
  value?: string
  onValueChange?: (v: string) => void
  fieldRef?: React.Ref<HTMLTextAreaElement>
  /** journals and stories get a title line; a burden is just the thing said */
  titled?: boolean
  /** an extra control on the submit row — "keep it private instead" */
  aside?: React.ReactNode
  /**
   * Where the words actually go.
   *
   * Supplied by the caller because each surface writes somewhere different: a
   * post to /api/community/posts, a reply to that post's replies. Composers on
   * surfaces with no API yet (circles) pass nothing and keep their local
   * behaviour rather than pretending to send.
   */
  onSubmit?: (text: string) => Promise<void>
}) {
  const [own, setOwn] = useState('')
  const [title, setTitle] = useState('')
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const text = value ?? own
  const setText = onValueChange ?? setOwn

  /** The whole branch. A post is the member's own; everything else is aimed at
      somebody. */
  const isPost = surface === 'post'
  const serverSurface: ServerSurface = surface === 'reply' ? 'comment' : surface

  /* `settled` distinguishes a finished sentence from a fragment: mid-word,
     the check stays neutral rather than telling someone their unfinished
     thought is harsh. On a post the result is used only for its word count. */
  const settled = /[.!?…]\s*$|\n\s*$/.test(text) || countWords(text) > 12
  const result = useMemo(() => preflight(text, settled), [text, settled])

  const limit = WORD_LIMIT[kind][plan]
  const overLimit = limit !== null && result.words > limit

  /* A2, on a post, in the background. Sets a flag and renders nothing. */

  /* §14.2 — the decision, for the surfaces that have one. Not asked for a post:
     no category is in scope there, so the answer is `allowed` every time and
     the request is noise. */
  const server = useServerCheck(text, serverSurface, !isPost)
  const sv = server.verdict

  /* A reply sends only when nothing was found in it.

     "Nothing" means no category, not merely no block — `limited_visibility` and
     an advisory reword both used to leave the button live, so a reply A1 had
     objected to could go out anyway. Two things are deliberately not counted:

       privacy   the member's own contact details. Their information, their
                 call, and not aimed at anybody.
       ownrisk   the member's own distress. That is A2's question and it is
                 answered after publishing, never by refusing to publish. A
                 responder who says they are struggling too must not find the
                 button dead. */
  const serverFound = sv
    ? sv.categories.length > 0 ||
      sv.decision === 'blocked' ||
      sv.decision === 'limited_visibility'
    : false
  const deviceFound =
    !!result.concern && result.concern.id !== 'privacy' && result.concern.id !== 'ownrisk'

  /* Either layer can stop a reply. Not "the server decides once it answers",
     which is what this was.

     That version was right about which layer is more trustworthy and wrong
     about what its silence means. a1-v10 scores
     `help_seeking_discouragement` at 0.000 on every input — fifteen examples in
     the corpus, `support: 0` in the threshold file, so the head was never
     trained — and five more categories are in the same state. The server
     answering `allowed` for those is not a judgement that the text is fine; it
     is a model with no opinion, and treating it as an override deleted the only
     check that had one. "You should keep it to yourself" went out unremarked.

     A union costs a false gate where the device patterns are coarse, and that
     gate is appealable. Silence where the model has no head costs the reply. */
  const gated = !isPost && (serverFound || deviceFound)

  /* Guidance comes from whichever layer decided, so the words on screen always
     match the thing that actually stopped the member. */
  const guidance = sv?.rewrite_guidance ?? result.concern?.guidance ?? ''

  const ready = result.words > 0 && !gated && !overLimit && (isPost || result.verdict !== 'typing')

  /* The read has to agree with the gate underneath it.

     The two layers see different things — "keep your problems to yourself" is
     not in the device patterns but a1-v10 flags it — so the read was announcing
     "Your message is ready to post" immediately above a panel saying the reply
     could not be sent. A member reading top to bottom is told yes and then no,
     and neither line admits the other exists.

     The gate is the fact; the read is restated to match it. When the server
     found something the device did not, the headline moves to `reword` with no
     concern block — the panel below names it. When neither found anything, the
     read is clear. */
  const shown: Preflight = useMemo(() => {
    if (isPost || result.verdict === 'empty' || result.verdict === 'typing') return result
    if (gated) return { ...result, verdict: 'reword', headline: headlineFor('reword') }
    if (!sv) return result
    return { ...result, verdict: 'clear', headline: headlineFor('clear'), concern: undefined }
  }, [isPost, sv, gated, result])

  /* Nothing safety-related happens in here, and that is the point. Crisis
     triage runs on the server against the text that actually published, and
     A1 checks a reply server side before it is stored — the composer cannot
     talk its way past either. Doing the triage here meant reading drafts,
     which the consent text promises we do not. */
  async function publish() {
    if (sending) return
    setRefusal(null)

    if (onSubmit === undefined) {
      setSent(true)
      return
    }

    setSending(true)
    try {
      await onSubmit(text)
      setSent(true)
    } catch (err) {
      /* Each refusal says a different thing, and they are not interchangeable.
         Telling somebody their words were rejected when a service was down, or
         that they are out of allowance when they withdrew consent, is worse
         than saying nothing. */
      if (err instanceof ApiError) {
        if (err.isModerationUnavailable) {
          setRefusal(
            'The safety check could not run just now, so this has not been sent. Nothing was rejected — please try again in a moment.',
          )
        } else if (err.isQuotaExceeded) {
          const q = err.quota
          setRefusal(
            q
              ? `You have used all ${q.limit} of this month's posts. The next one is available from ${new Date(q.resetsAt).toLocaleDateString()}.`
              : 'You have used this month\u2019s allowance.',
          )
        } else if (err.isNotEntitled) {
          setRefusal(err.message)
        } else if (err.isConsentWithdrawn) {
          setRefusal(
            'You withdrew consent for this. Nothing you have already written was removed.',
          )
        } else if (err.status === 422) {
          setRefusal(err.message)
        } else {
          setRefusal('That could not be sent just now.')
        }
      } else {
        setRefusal('We could not reach the server. Nothing was sent.')
      }
    } finally {
      setSending(false)
    }
  }

  function clear() {
    setSent(false)
    setRefusal(null)
    setText('')
    setTitle('')
  }

  if (sent) {
    return (
      <div
        className={`cm-rise rounded-[14px] border px-4 py-3.5 ${
          dark
            ? 'border-[rgb(244_241_234/0.2)] bg-[rgb(244_241_234/0.06)]'
            : 'border-[var(--cm-edge)] bg-[var(--cm-sunken)]'
        }`}
      >
        <p
          className={`text-[0.8rem] font-medium ${
            dark ? 'text-[var(--app-on-dark)]' : 'text-[var(--cm-hold-ink)]'
          }`}
        >
          {/* One line, whatever was found. A member who was flagged and one who
              was not read the same words: telling somebody "we have alerted the
              safety team about you" is the frontend alert this design does not
              have. The platform reaches them as a person instead. */}
          Sent. It is live now.
        </p>
        <button
          type="button"
          onClick={clear}
          className={`mt-2 text-[0.74rem] font-semibold underline underline-offset-4 ${
            dark ? 'text-[var(--app-gold-lit)]' : 'text-[var(--app-ink)]'
          }`}
        >
          Write another
        </button>
      </div>
    )
  }

  return (
    <div>
      {titled && (
        <>
          <label className="sr-only" htmlFor={`title-${label}`}>
            Title
          </label>
          <input
            id={`title-${label}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Give it a name, or don't"
            className={`${DISPLAY} mb-2.5 w-full rounded-[12px] border bg-transparent px-4 py-3 text-[1.05rem] leading-snug outline-none ${
              dark
                ? 'border-[rgb(244_241_234/0.2)] text-[var(--app-on-dark)] placeholder:text-[var(--app-on-dark-dim)] focus-visible:border-[var(--app-gold-lit)]'
                : 'border-[rgb(27_23_18/0.1)] text-[var(--app-ink)] placeholder:text-[var(--app-dim)] focus-visible:border-[var(--app-gold)]'
            }`}
          />
        </>
      )}

      <label className="sr-only" htmlFor={`compose-${label}`}>
        {label}
      </label>
      <textarea
        id={`compose-${label}`}
        ref={fieldRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className={`w-full resize-y rounded-[14px] border p-4 text-[0.9rem] leading-relaxed outline-none ${
          compact ? 'min-h-[92px]' : 'min-h-[136px] sm:min-h-[160px]'
        } ${
          dark
            ? 'border-[rgb(244_241_234/0.2)] bg-[rgb(244_241_234/0.07)] text-[var(--app-on-dark)] placeholder:text-[var(--app-on-dark-dim)] focus-visible:border-[var(--app-gold-lit)]'
            : /* A post's field never changes colour. There is no verdict on it
                 to render, and tinting the box someone is writing their worst
                 night into is a comment whether or not any words accompany it. */
              gated
              ? 'border-[var(--cm-alert-edge)] bg-[var(--cm-sunken)] text-[var(--app-ink)] placeholder:text-[var(--app-dim)] focus-visible:border-[var(--cm-alert)]'
              : 'border-[rgb(27_23_18/0.1)] bg-[var(--cm-sunken)] text-[var(--app-ink)] placeholder:text-[var(--app-dim)] focus-visible:border-[var(--app-gold)] focus-visible:bg-[var(--cm-paper)]'
        }`}
      />

      {/* Everything below is for words aimed at another person. A post gets
          none of it — no read, no category, no suggestion, no question. */}
      {!isPost && (
        <>
          <SafetyRead result={shown} dark={dark} />

          {/* What the read means for this member, here, now. `SafetyRead` says
              what was noticed; this says that it is stopped, and what to do if
              the check has them wrong. */}
          {gated && guidance && (
            <RewriteGate guidance={guidance} recipient={recipient} dark={dark} />
          )}

          {/* Which layer is speaking. A member who is stopped deserves to know
              whether a considered decision stopped them or the network did. */}
          {server.state === 'offline' && result.words > 0 && (
            <p
              className={`mt-2 text-[0.72rem] leading-relaxed ${
                dark ? 'text-[var(--app-on-dark-dim)]' : 'text-[var(--app-faint)]'
              }`}
            >
              Checked on your device only — the safety service could not be reached. It runs again
              when you send, so this may still come back for a rewrite.
            </p>
          )}
        </>
      )}

      {overLimit && (
        <p
          className={`mt-2 text-[0.75rem] leading-relaxed ${
            dark ? 'text-[#e8a88e]' : 'text-[var(--cm-alert-ink)]'
          }`}
        >
          {plan === 'free'
            ? `The free plan keeps ${kind === 'story' ? 'a story' : 'an entry'} to ${limit?.toLocaleString()} words. Interaction Plus lifts it to ${WORD_LIMIT[kind].plus?.toLocaleString()}.`
            : `${limit?.toLocaleString()} words is the ceiling on ${
                kind === 'story' ? 'a story' : 'an entry'
              }. Trim it, or split it across two.`}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
        <WordMeter words={result.words} limit={limit} dark={dark} />
        {aside}
        {onCancel && (
          <button
            type="button"
            onClick={() => {
              /* Closed without posting. The flag goes with it — nothing that
                 was typed here and abandoned reaches mediation. */
              onCancel()
            }}
            className={`min-h-10 text-[0.74rem] font-semibold ${
              dark
                ? 'text-[var(--app-on-dark-dim)] hover:text-[var(--app-on-dark)]'
                : 'text-[var(--app-faint)] hover:text-[var(--app-ink)]'
            }`}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          disabled={!ready || sending}
          onClick={() => void publish()}
          className={`ml-auto flex min-h-11 flex-none items-center justify-center rounded-full px-5 text-[0.78rem] font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${
            dark
              ? 'bg-[var(--app-gold-lit)] text-[#3a2a08]'
              : 'bg-[var(--app-ink)] text-[var(--app-rail)]'
          }`}
        >
          {sending ? 'Sending…' : gated ? 'Rewrite to send' : submitLabel}
        </button>
      </div>

      {/* The server's refusal, in the server's own terms. Shown under the
          button rather than replacing the draft: whatever they wrote is still
          in the box, because losing it is the one thing that would make a
          refusal unforgivable. */}
      {refusal !== null && (
        <p
          role="status"
          className={`mt-3 rounded-[12px] px-3.5 py-2.5 text-[0.78rem] leading-relaxed ${
            dark
              ? 'bg-[rgb(244_241_234/0.08)] text-[var(--app-on-dark)]'
              : 'bg-[var(--cm-sunken)] text-[var(--app-body)]'
          }`}
        >
          {refusal}
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- the thread -- */

/** Where a post sits in the feed. Both other sections send people here rather
    than carrying a second copy of the thread, so the id has to be derivable
    from the slug alone on either side. */
function postAnchor(slug: string) {
  return `cm-post-${slug}`
}

/** Bring a post into view. Smooth unless the reader has asked the system for
    less motion, in which case it jumps — a long animated scroll is exactly the
    kind of movement that setting exists to switch off. */
function scrollToPost(slug: string) {
  const el = document.getElementById(postAnchor(slug))
  if (!el) return
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' })
}

/* §5.1 counts every reply against the free plan's two.

   Flat, because the server stores them flat. There is no sub-reply: a thread
   that branches turns a conversation into an argument with sides, and the one
   shape community-service keeps is a list. `depth` stays in the signature
   because the row component still indents the AI's response. */
function flatten(replies: Reply[]): { reply: Reply; depth: number }[] {
  return replies.map((reply) => ({ reply, depth: 0 }))
}

/* A handle is the whole identity anyone gets here, so the avatar can only be
   its first letter. The tint is derived from the handle rather than stored,
   which means the same person is the same colour in every thread without any
   record being kept about them. */
const TINTS = ['#dce4d4', '#e4d9e8', '#d6e0e6', '#e8dcd2', '#f0dcae']

function tintFor(handle: string) {
  let n = 0
  for (const ch of handle) n = (n + ch.charCodeAt(0)) % TINTS.length
  return TINTS[n]
}

function ReplyRow({
  reply,
  depth,
  onRespond,
  open,
  plan,
  myHandle,
}: {
  reply: Reply
  depth: number
  onRespond: (key: string | null) => void
  open: boolean
  plan: Plan
  /** The signed-in member's handle, so a reply can be marked as theirs. */
  myHandle: string | undefined
}) {
  const key = reply.ref
  const mine = reply.handle === myHandle

  return (
    <li style={{ marginInlineStart: Math.min(depth, 3) * 26 }}>
      <div className="cm-rise rounded-[14px] border border-[var(--cm-edge)] border-l-2 border-l-[rgb(27_23_18/0.14)] bg-[var(--cm-sunken)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span
            aria-hidden="true"
            className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full text-[0.6rem] font-semibold text-[var(--app-ink)]"
            style={{ background: tintFor(reply.handle) }}
          >
            {reply.handle.charAt(0)}
          </span>
          <Handle>{reply.handle}</Handle>
          {mine && (
            <span className={`${LABEL} tracking-[0.12em] text-[var(--app-gold-ink)]`}>You</span>
          )}
          <span className={`${LABEL} tracking-[0.12em] text-[var(--app-dim)]`}>{reply.ago}</span>
          {reply.fromAi && (
            <span className="rounded-full bg-[rgb(224_172_92/0.22)] px-2 py-0.5 text-[0.62rem] font-medium text-[var(--app-gold-ink)]">
              Alaap AI
            </span>
          )}
        </div>

        <p className="mt-2 text-[0.82rem] leading-relaxed text-[var(--app-body)]">
          {reply.body}
        </p>

        <button
          type="button"
          onClick={() => onRespond(open ? null : key)}
          className="mt-2 min-h-9 text-[0.74rem] font-semibold text-[var(--app-gold-ink)] transition-colors hover:text-[var(--app-ink)]"
        >
          {open ? 'Cancel' : 'Respond to this'}
        </button>
      </div>

      {open && (
        <div className="cm-rise mt-2 rounded-[16px] border border-[var(--app-gold)] bg-[var(--cm-paper)] p-4">
          <p className={`${LABEL} mb-2.5 tracking-[0.14em] text-[var(--app-gold-ink)]`}>
            Replying to {reply.handle}
          </p>
          <Composer
            plan={plan}
            compact
            surface="reply"
            recipient={reply.handle}
            label={`Reply to ${reply.handle}`}
            placeholder="Say what you'd want to hear."
            submitLabel="Send response"
            onCancel={() => onRespond(null)}
          />
        </div>
      )}
    </li>
  )
}

/** The held replies, drawn at their real size and blurred. §5.1 — they were
    accepted and kept, so they are shown as what they are: people, withheld. */
function HeldReplies({ n, onOpen }: { n: number; onOpen: () => void }) {
  return (
    <li className="relative overflow-hidden rounded-[14px] border border-[var(--cm-edge)]">
      <div aria-hidden="true" className="select-none bg-[var(--cm-sunken)] px-4 py-3 opacity-55 blur-[5px]">
        <p className="text-[0.82rem] leading-relaxed text-[var(--app-body)]">
          Someone wrote you three paragraphs about the exact same Tuesday, and two others added to
          it underneath.
        </p>
        <p className="mt-2 text-[0.82rem] leading-relaxed text-[var(--app-body)]">
          I read this twice before replying because I wanted to get it right.
        </p>
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[rgb(247_243_233/0.55)] px-4 text-center">
        <p className="text-[0.8rem] font-semibold text-[var(--app-ink)]">
          {n} more {n === 1 ? 'response' : 'responses'}, kept and waiting
        </p>
        <button
          type="button"
          onClick={onOpen}
          className="flex min-h-10 items-center rounded-full bg-[var(--app-ink)] px-4 text-[0.74rem] font-semibold text-[var(--app-rail)] transition-opacity hover:opacity-90"
        >
          Read them with Plus
        </button>
      </div>
    </li>
  )
}

function ThreadCard({
  thread,
  plan,
  myHandle,
  categoryLabel,
  onUpgrade,
  onReplied,
  open,
  onToggle,
}: {
  thread: Thread
  plan: Plan
  myHandle: string | undefined
  /** Resolves a category id to the server's words for it. */
  categoryLabel: (id: string) => string
  onUpgrade: () => void
  /** Re-read the thread after a reply is published. */
  onReplied: () => void
  /* Open state is the feed's, not the card's, so that arriving from another
     section can land on this post already unfolded. */
  open: boolean
  onToggle: (open: boolean) => void
}) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const setOpen = (v: boolean | ((p: boolean) => boolean)) =>
    onToggle(typeof v === 'function' ? v(open) : v)

  const flat = flatten(thread.replies)
  const visible = plan === 'plus' ? flat.length : Math.min(FREE_VISIBLE_PEERS, flat.length)
  const held = flat.length - visible
  const mine = thread.handle === myHandle
  /* Everything on the feed is a burden post. Journals and stories live in the
     clinical vault and are never published here, so there is no kind to pick. */
  const kind = KINDS.find((k) => k.id === 'post')

  function respondToRoot() {
    setOpen(true)
    setReplyingTo(replyingTo === 'root' ? null : 'root')
  }

  return (
    <article
      id={postAnchor(thread.ref)}
      className={`${CARD} scroll-mt-4 p-5 ${mine ? 'border-[rgb(224_172_92/0.5)]' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <Handle>{thread.handle}</Handle>
        {mine && (
          <span className="rounded-full bg-[rgb(224_172_92/0.22)] px-2.5 py-0.5 text-[0.64rem] font-semibold text-[var(--app-gold-ink)]">
            Your post
          </span>
        )}
        <span
          className={`${LABEL} rounded-[5px] bg-[var(--cm-stone)] px-1.5 py-1 tracking-[0.1em] text-[var(--app-muted)]`}
        >
          {kind?.short}
        </span>
        <span className="text-[0.72rem] text-[var(--app-faint)]">
          {categoryLabel(thread.categoryId)} · {thread.ago}
        </span>
        {/* Only where there is one. A post that does not expire says nothing
            rather than "Expires in ", which is how a blank turns into a bug
            report. */}
        {thread.expiresIn && (
          <span className={`${LABEL} ml-auto tracking-[0.12em] text-[var(--app-dim)]`}>
            {thread.expiresIn}
          </span>
        )}
      </div>

      {/* No heading. A post has no title — the same reason a journal entry has
          none: a title is content, and asking somebody to summarise their worst
          week in six words before they may write about it is a bad thing to
          ask. The words lead. */}
      <p className="mt-3 text-[0.88rem] leading-relaxed text-[var(--app-body)]">
        {thread.body}
      </p>

      {/* §5.1 gives every post one AI supportive response, on every plan. A
          rule down the side rather than a box: it is part of the post, not an
          advertisement sitting on top of it. */}
      <div className="mt-4 border-l-2 border-[#e4d6b4] pl-4">
        <p
          className={`${LABEL} flex items-center gap-1.5 tracking-[0.14em] text-[var(--app-gold-ink)]`}
        >
          <Glyph d={PATH.spark} size={12} />
          Alaap AI · first response
        </p>
        {/* 'pending' is a real state and shows as one. B1 writes its reply a
            moment after the post lands, and pretending otherwise would leave an
            empty rule down the side of somebody's post. */}
        <p className="mt-2 text-[0.85rem] leading-relaxed text-[var(--app-body)]">
          {aiReply(thread)?.body ??
            (thread.aiResponseState === 'pending'
              ? 'Writing a response…'
              : 'No response was written for this post.')}
        </p>
        <p className="mt-2 text-[0.7rem] leading-relaxed text-[var(--app-faint)]">
          Support, not diagnosis. No clinician sees anything here unless you ask.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={respondToRoot}
          className="flex min-h-11 items-center gap-1.5 rounded-full bg-[var(--app-gold-lit)] px-4 text-[0.76rem] font-semibold text-[#3a2a08] transition-opacity hover:opacity-90"
        >
          <Glyph d={PATH.reply} size={13} />
          Respond to {thread.handle}
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-11 items-center rounded-full border border-[var(--cm-edge-strong)] px-4 text-[0.76rem] font-semibold text-[var(--app-muted)] transition-colors hover:border-[rgb(27_23_18/0.36)] hover:text-[var(--app-ink)]"
        >
          {open
            ? 'Fold thread'
            : `Open ${flat.length} ${flat.length === 1 ? 'response' : 'responses'}`}
        </button>
        <span className={`${LABEL} tracking-[0.1em] text-[var(--app-dim)]`}>
          every one checked before it appeared
        </span>
      </div>

      {replyingTo === 'root' && (
        <div className="cm-rise mt-3 rounded-[16px] border border-[var(--app-gold)] bg-[var(--cm-paper)] p-4">
          <p className={`${LABEL} mb-2.5 tracking-[0.14em] text-[var(--app-gold-ink)]`}>
            Replying to {thread.handle}
          </p>
          <Composer
            plan={plan}
            compact
            surface="reply"
            recipient={thread.handle}
            label={`Reply to ${thread.handle}`}
            placeholder="You do not have to have an answer for them."
            submitLabel="Send response"
            onCancel={() => setReplyingTo(null)}
            onSubmit={async (text) => {
              /* A1 reads this server side before it is published. A blocked
                 reply comes back 422 with a verdict to appeal against, and an
                 unreachable classifier comes back 503 — the composer shows
                 those as different things because they are. */
              await createReply(thread.ref, text)
              onReplied()
            }}
          />
        </div>
      )}

      {open && (
        <>
          <ul className="mt-3 flex flex-col gap-2">
            {flat.slice(0, visible).map((n) => (
              <ReplyRow
                key={n.reply.ref}
                reply={n.reply}
                myHandle={myHandle}
                depth={n.depth}
                plan={plan}
                open={replyingTo === n.reply.handle + n.reply.ago}
                onRespond={setReplyingTo}
              />
            ))}
            {held > 0 && <HeldReplies n={held} onOpen={onUpgrade} />}
          </ul>

          {held > 0 && (
            <p className="mt-3 text-[0.76rem] leading-relaxed text-[var(--app-faint)]">
              {mine
                ? `They were accepted and kept — nobody's reply went nowhere. Interaction Plus opens all ${flat.length}.`
                : `${held} more ${held === 1 ? 'response is' : 'responses are'} visible to this author on Interaction Plus.`}
            </p>
          )}
        </>
      )}
    </article>
  )
}

/* --------------------------------------------------------------- the feed -- */

function FeedSection({
  plan,
  myHandle,
  onUpgrade,
  onWrite,
  target,
}: {
  plan: Plan
  onUpgrade: () => void
  /** the feed no longer writes; it hands the member to the section that does */
  onWrite: () => void
  /** a post another section asked the feed to land on, and the press that
      asked — the counter is what makes asking twice work */
  target: { ref: string; nonce: number } | null
  /** The signed-in member's handle, for marking their own posts. */
  myHandle: string | undefined
}) {
  const [topic, setTopic] = useState('All')
  const [openSlug, setOpenSlug] = useState<string | null>(null)

  const feed = useThreads(25)
  const categories = useCategories()

  /* Topics come from the server, not from what happens to be in the feed.
     Deriving them from the posts on screen means a quiet topic vanishes from
     the filter, which reads as the platform having removed it. */
  const topics = ['All', ...(categories.data ?? []).map((c) => c.id)]
  const label = (id: string) =>
    id === 'All' ? 'All' : ((categories.data ?? []).find((c) => c.id === id)?.label ?? id)

  const threads = feed.data ?? []
  const shown = topic === 'All' ? threads : threads.filter((t) => t.categoryId === topic)

  /* Arriving from Yours or from Say it anonymously. The filter is cleared
     first — landing on a post that the current filter excludes would scroll to
     nothing — then the thread is unfolded and brought into view. */
  useEffect(() => {
    if (!target) return
    setTopic('All')
    setOpenSlug(target.ref)
    /* Scrolled straight from the effect rather than from a rAF callback. The
       card's own position is settled by the time effects run — the thread
       unfolds below the anchor, not above it — and rAF is throttled to nothing
       in a background tab, which is exactly when a queued scroll is lost. */
    scrollToPost(target.ref)
  }, [target])

  return (
    <>
      {/* There is one composer on this tab and it lives on Say it anonymously.
          Two writing surfaces meant two answers to "where does this go?", and
          that one is where the promise is stated, so the feed reads and points
          rather than offering a second box. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className={`${LABEL} tracking-[0.16em]`}>Carrying</span>
        <div className="flex flex-wrap gap-1.5">
          {topics.map((t) => (
            <Pill key={t} small on={topic === t} onClick={() => setTopic(t)}>
              {label(t)}
            </Pill>
          ))}
        </div>
        <button
          type="button"
          onClick={onWrite}
          className="ml-auto flex min-h-10 flex-none items-center gap-1.5 rounded-full bg-[var(--app-gold-lit)] px-4 text-[0.74rem] font-semibold text-[#3a2a08] transition-opacity hover:opacity-90"
        >
          <Glyph d={PATH.pen} size={13} />
          Write something
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {/* Three states, and none of them is the other two.

            Loading is not emptiness, and emptiness is not failure. A member
            looking at a quiet hour should be told it is quiet, not shown a
            blank that could mean anything. */}
        {feed.loading && (
          <p className={`${LABEL} tracking-[0.12em] text-[var(--app-dim)]`}>Loading the feed</p>
        )}
        {!feed.loading && feed.error !== undefined && (
          <p className="rounded-[14px] border border-[var(--cm-edge)] bg-[var(--cm-sunken)] px-4 py-3 text-[0.82rem] leading-relaxed text-[var(--app-body)]">
            The feed could not be loaded just now. Nothing you have written is
            affected.
          </p>
        )}
        {!feed.loading && feed.error === undefined && shown.length === 0 && (
          <p className="rounded-[14px] border border-[var(--cm-edge)] bg-[var(--cm-sunken)] px-4 py-3 text-[0.82rem] leading-relaxed text-[var(--app-body)]">
            {topic === 'All'
              ? 'Nothing here yet. Posts stay for five days, so the wall empties on its own — if you have something to put down, you would be first.'
              : 'Nothing under this one right now.'}
          </p>
        )}
        {shown.map((t) => (
          <ThreadCard
            key={t.ref}
            thread={t}
            plan={plan}
            myHandle={myHandle}
            categoryLabel={label}
            onUpgrade={onUpgrade}
            onReplied={feed.reload}
            open={openSlug === t.ref}
            onToggle={(v) => setOpenSlug(v ? t.ref : null)}
          />
        ))}
      </div>
    </>
  )
}

/* --------------------------------------------------- say it anonymously -- */

/** A preview of something already put down. It carries no controls of its own:
    responding, holding and reading the thread all happen where the post
    actually lives, and a second set of buttons here would have meant a second
    copy of the post's state to keep honest. */
function PutDownCard({
  thread,
  onOpen,
  myHandle,
  categoryLabel,
}: {
  thread: Thread
  onOpen: () => void
  myHandle: string | undefined
  categoryLabel: (id: string) => string
}) {
  const kind = KINDS.find((k) => k.id === 'post')
  const replies = thread.replyCount
  const mine = thread.handle === myHandle

  return (
    <article className={`${CARD} flex flex-col p-5`}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <Handle>{thread.handle}</Handle>
        {mine && (
          <span className={`${LABEL} tracking-[0.12em] text-[var(--app-gold-ink)]`}>You</span>
        )}
        <span className="rounded-full bg-[var(--cm-stone)] px-2.5 py-1 text-[0.68rem] text-[var(--app-muted)]">
          {kind?.short}
        </span>
        <span className={`${LABEL} ml-auto tracking-[0.12em] text-[var(--app-dim)]`}>
          {thread.ago}
        </span>
      </div>

      {/* No title, for the reason given on ThreadCard. */}
      <p className="mt-3 flex-1 text-[0.86rem] leading-relaxed text-[var(--app-body)]">
        {thread.body}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--cm-edge)] pt-3.5">
        <span className="text-[0.74rem] text-[var(--app-muted)]">
          {replies} {replies === 1 ? 'response' : 'responses'} · {categoryLabel(thread.categoryId)}
        </span>
        <button
          type="button"
          onClick={onOpen}
          className="ml-auto flex min-h-10 items-center gap-1.5 rounded-full border border-[var(--cm-edge-strong)] px-4 text-[0.74rem] font-semibold text-[var(--app-ink)] transition-colors hover:border-[rgb(27_23_18/0.36)] hover:bg-[rgb(27_23_18/0.04)]"
        >
          Open in the feed
          <Glyph d={PATH.arrow} size={13} />
        </button>
      </div>
    </article>
  )
}
/** What the free plan is shown in place of a journal or a story composer.
    The shape of the thing is drawn and blurred rather than replaced with a
    banner, for the same reason a held reply is: what is behind the plan should
    be legibly the real feature, not an advertisement standing where it was.

    The two layers are stacked in one grid cell rather than positioned, so the
    panel is as tall as whichever needs more room. Absolute positioning meant
    the blurred sample set the height and the message was clipped out of it at
    narrow widths, where the message is exactly the part that wraps.

    Only the sample is blurred. The ask sits on its own opaque card on top of
    it, so nothing of the haze reaches the words a member is being asked to
    read and act on — a scrim laid over a blurred layer dims the type it is
    carrying, which is the one thing on this panel that must stay crisp. */
function LockedComposer({ kindLabel, onUpgrade }: { kindLabel: string; onUpgrade: () => void }) {
  return (
    <div className="grid overflow-hidden rounded-[14px] border border-[var(--cm-edge)] bg-[var(--cm-sunken)]">
      <div
        aria-hidden="true"
        className="col-start-1 row-start-1 select-none p-5 opacity-55 blur-[5px]"
      >
        <p className={`${DISPLAY} text-[1.05rem] leading-snug text-[var(--app-ink)]`}>
          Things I have not said out loud to anyone
        </p>
        <p className="mt-2.5 text-[0.9rem] leading-relaxed text-[var(--app-body)]">
          My mother has been unwell for fourteen months and I have started to resent the phone. Not
          her — the phone. I answer every time and I am kind every time, and afterwards I sit in the
          car park doing nothing at all for twenty minutes.
        </p>
        <p className="mt-2 text-[0.9rem] leading-relaxed text-[var(--app-body)]">
          I have never told anyone that the twenty minutes is the best part of my day.
        </p>
      </div>

      <div className="col-start-1 row-start-1 grid place-items-center p-4">
        <div className="flex flex-col items-center gap-2.5 rounded-[16px] bg-[image:var(--app-dark)] px-5 py-6 text-center shadow-[0_10px_30px_rgb(27_23_18/0.28)]">
          <span className="text-[var(--app-gold-lit)]">
            <Glyph d={PATH.lock} size={20} />
          </span>
          <p className="text-[0.86rem] font-semibold text-[var(--app-on-dark)]">
            {kindLabel} is part of Interaction Plus
          </p>
          <p className="max-w-[46ch] text-[0.78rem] leading-relaxed text-[var(--app-on-dark-soft)]">
            Up to {WORD_LIMIT.journal.plus?.toLocaleString()} words, long enough that the form stops
            being the thing you are fighting. A burden stays free and uncapped on every plan.
          </p>
          <button
            type="button"
            onClick={onUpgrade}
            className="mt-1 flex min-h-11 items-center rounded-full bg-[var(--app-gold-lit)] px-5 text-[0.78rem] font-semibold text-[#3a2a08] transition-opacity hover:opacity-90"
          >
            Subscribe to Interaction Plus
          </button>
        </div>
      </div>
    </div>
  )
}

/** The ceiling, said in words rather than left to the bar. It appears only in
    the last fifth of the allowance — a limit announced at word four is a toll
    gate; the same limit announced near the end is information. */
function CeilingNote({
  left,
  kindLabel,
  plan,
  onUpgrade,
}: {
  left: number
  kindLabel: string
  plan: Plan
  onUpgrade: () => void
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[12px] bg-[var(--cm-stone)] px-4 py-3.5">
      <div className="min-w-[220px] flex-1">
        <p className="text-[0.8rem] font-semibold text-[var(--app-ink)]">
          {left.toLocaleString()} {left === 1 ? 'word' : 'words'} left in this entry
        </p>
        <p className="mt-1 text-[0.76rem] leading-relaxed text-[var(--app-body)]">
          {plan === 'free'
            ? `${kindLabel} stops there without Interaction Plus. Plus takes it to ${WORD_LIMIT.journal.plus?.toLocaleString()} — long enough that the form stops being the thing you are fighting.`
            : `${kindLabel} stops there. If it is still going, the second half is its own entry and probably a better one.`}
        </p>
      </div>
      {plan === 'free' && (
        <button
          type="button"
          onClick={onUpgrade}
          className="flex min-h-10 flex-none items-center rounded-full bg-[var(--app-ink)] px-4 text-[0.74rem] font-semibold text-[var(--app-rail)] transition-opacity hover:opacity-90"
        >
          Raise the limit
        </button>
      )}
    </div>
  )
}

function AnonymousSection({
  plan,
  onUpgrade,
  onOpenPost,
  focusSignal,
  myHandle,
}: {
  plan: Plan
  onUpgrade: () => void
  /** send the reader to where a post actually lives */
  onOpenPost: (ref: string) => void
  /** bumped when the quiet prompt or the feed sends somebody here to write */
  focusSignal: number
  myHandle: string | undefined
}) {
  const [kind, setKind] = useState<PostKind>('post')
  const [draft, setDraft] = useState('')

  /* Categories, own posts and their words all come from the server. The
     category picker in particular must not ship its own list: these are
     situations rather than conditions, and a stale client list offers topics
     the server refuses outright. */
  const categories = useCategories()
  const own = useOwnThreads()
  const categoryList = categories.data ?? []
  const [category, setCategory] = useState<string>('')
  const chosen = category || categoryList[0]?.id || ''
  const categoryLabel = (id: string) =>
    categoryList.find((c) => c.id === id)?.label ?? id
  const field = useRef<HTMLTextAreaElement>(null)

  const active = KINDS.find((k) => k.id === kind)!
  /* §5.2 — journals and stories are the Plus feature. On the free plan the
     composer for them is shown locked rather than capped. */
  const locked = active.plus && plan === 'free'
  const limit = WORD_LIMIT[kind][plan]
  const words = countWords(draft)
  const nearCeiling = limit !== null && words > limit * 0.8 && words <= limit

  useEffect(() => {
    if (focusSignal === 0) return
    const el = field.current
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
  }, [focusSignal])

  return (
    <>
      {/* The promise, before anybody types into it. It is the only reason to
          use this section rather than the feed, so it is stated at the head of
          the section and not in a help page. */}
      <section className="rounded-[20px] bg-[image:var(--app-dark)] p-5 text-[var(--app-on-dark)]">
        <p className={`${LABEL} tracking-[0.16em] text-[var(--app-gold-lit)]`}>Say it anonymously</p>
        <h2 className={`${DISPLAY} mt-2.5 text-[1.4rem] leading-tight`}>
          No name, no avatar. One handle, issued to you and to nobody else.
        </h2>
        <ul className="mt-4 grid gap-x-6 gap-y-2.5 sm:grid-cols-3">
          {ANON_TERMS.map((t) => (
            <li
              key={t}
              className="border-t border-[rgb(244_241_234/0.16)] pt-2.5 text-[0.76rem] leading-relaxed text-[var(--app-on-dark-soft)]"
            >
              {t}
            </li>
          ))}
        </ul>
      </section>

      {/* The composer. Light paper against the dark promise above it, because
          this is the part somebody is meant to work in. */}
      <section className={`${CARD} mt-3 overflow-hidden`}>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--cm-edge)] p-4">
          {KINDS.map((k) => (
            <Pill
              key={k.id}
              on={kind === k.id}
              onClick={() => setKind(k.id)}
              note={k.plus && plan === 'free' ? 'PLUS' : undefined}
            >
              {k.short}
            </Pill>
          ))}
          {/* The handle, and no control beside it. It is issued to the account
              once and cannot be swapped, which is the point: a handle you can
              replace is not an identity anyone can answer. */}
          <span className="ml-auto flex items-center gap-2">
            <span className={`${LABEL} tracking-[0.14em]`}>Posting as</span>
            <Handle>{myHandle ?? '—'}</Handle>
          </span>
        </div>

        <div className="p-4 sm:p-5">
          {locked ? (
            <LockedComposer kindLabel={active.label} onUpgrade={onUpgrade} />
          ) : (
            <>
              <Composer
                plan={plan}
                kind={kind}
                titled={kind !== 'post'}
                label={`Anonymous · ${active.label}`}
                placeholder="The thing you haven't said to anyone yet."
                submitLabel="Post anonymously"
                fieldRef={field}
                value={draft}
                onValueChange={setDraft}
                onSubmit={async (text) => {
                  /* WHERE THE WORDS GO DEPENDS ON WHAT WAS CHOSEN.
                   *
                   * This called createPost for every kind, so picking "Journal
                   * entry" published a private entry to the public wall under the
                   * member's handle — while the control beside it promised the
                   * opposite. A journal is not a post with a different label; it
                   * lives in the clinical vault, encrypted per record, and the
                   * community feed must never see it.
                   *
                   * A post is published as written: a member's own post is never
                   * moderated, so there is no verdict to wait for. A journal entry
                   * can be refused for a plan or a withdrawn consent, and the
                   * composer renders those differently — see lib/api/errors.ts. */
                  if (kind === 'post') {
                    await createPost({ categoryId: chosen, body: text })
                    own.reload()
                    return
                  }
                  await writeJournal({ body: text })
                }}
                aside={
                  <span className="text-[0.74rem] text-[var(--app-faint)]">
                    Keep it private instead — goes to your own Journal
                  </span>
                }
              />
              {nearCeiling && limit !== null && (
                <CeilingNote
                  left={limit - words}
                  kindLabel={active.label}
                  plan={plan}
                  onUpgrade={onUpgrade}
                />
              )}
            </>
          )}

          {/* Filing it under something is how the section finds the people
              already carrying the same thing. It is the one detail a post
              keeps, and it says nothing about who wrote it. */}
          <div className="mt-4 border-t border-dashed border-[var(--cm-edge-strong)] pt-3.5">
            <h3 className={`${LABEL} tracking-[0.14em]`}>Filed under</h3>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {categoryList.map((c) => (
                <Pill
                  key={c.id}
                  small
                  disabled={locked}
                  on={chosen === c.id}
                  onClick={() => setCategory(c.id)}
                >
                  {c.label}
                </Pill>
              ))}
            </div>
            <p className="mt-3 text-[0.74rem] leading-relaxed text-[var(--app-dim)]">
              {active.blurb} Posted under {myHandle ?? 'your handle'} — the one handle issued to
              your account, and the only thing about you that anyone here can see.
            </p>
          </div>
        </div>
      </section>

      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className={`${DISPLAY} text-[1.15rem] leading-tight text-[var(--app-ink)]`}>
          Put down today
        </h2>
        <span className={`${LABEL} tracking-[0.12em] text-[var(--app-dim)]`}>
          {(own.data ?? []).length} {(own.data ?? []).length === 1 ? 'post' : 'posts'} · handles
          only, never names
        </span>
      </div>

      {/* Previews of real posts rather than a second feed. Each one opens
          where it lives, so there is exactly one place a thread can be read
          and exactly one copy of its state. */}
      <div className="mt-3 grid gap-3 min-[1120px]:grid-cols-2">
        {!own.loading && (own.data ?? []).length === 0 && (
          <p className="rounded-[14px] border border-[var(--cm-edge)] bg-[var(--cm-sunken)] px-4 py-3 text-[0.82rem] leading-relaxed text-[var(--app-body)]">
            You have not put anything down yet.
          </p>
        )}
        {(own.data ?? []).slice(0, 4).map((t) => (
          <PutDownCard
            key={t.ref}
            thread={t}
            myHandle={myHandle}
            categoryLabel={categoryLabel}
            onOpen={() => onOpenPost(t.ref)}
          />
        ))}
      </div>
    </>
  )
}

/* ------------------------------------------------------------- the circles -- */

/** The badge at the head of a card: how the room takes people. Two states, and
    the gold one is the one that costs the reader nothing to try. */
function DoorBadge({ door }: { door: CircleDoor }) {
  return (
    <span
      className={`${LABEL} flex-none rounded-[6px] px-2 py-1.5 tracking-[0.14em] ${
        door === 'open'
          ? 'bg-[var(--cm-gold-wash)] text-[var(--app-gold-ink)]'
          : 'bg-[var(--cm-stone)] text-[var(--app-muted)]'
      }`}
    >
      {door === 'open' ? 'Open' : 'Ask first'}
    </span>
  )
}

function CircleCard({
  circle,
  plan,
  standing,
  reason,
  onUpgrade,
  onEnter,
  onRequest,
  onRead,
}: {
  circle: Circle
  plan: Plan
  standing: CircleStanding
  /** why the shortlist brought this room up. Only set in that view — a card
      has to be able to say what put it in front of somebody. */
  reason?: string
  onUpgrade: () => void
  onEnter: () => void
  onRequest: () => void
  onRead: () => void
}) {
  const locked = plan === 'free'
  const inside = standing === 'member' || standing === 'founder'

  /* The whole card opens the room for somebody already in it. For everybody
     else it stays a card: there is nothing behind it to open yet, and a tile
     that swallows a click without going anywhere is worse than one that never
     offered. */
  const Root = inside && !locked ? 'button' : 'article'

  return (
    <Root
      {...(inside && !locked
        ? { type: 'button' as const, onClick: onEnter, 'aria-label': `Open ${circle.name}` }
        : {})}
      className={`${CARD} flex flex-col p-5 text-left ${
        inside && !locked
          ? 'transition-shadow hover:shadow-[0_8px_24px_rgb(27_23_18/0.1)]'
          : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className={`${DISPLAY} text-[1.1rem] leading-snug text-[var(--app-ink)]`}>
          {circle.name}
        </h3>
        <DoorBadge door={circle.door} />
      </div>

      {reason && (
        <p
          className={`${LABEL} mt-2.5 flex items-center gap-1.5 tracking-[0.12em] text-[var(--app-gold-ink)]`}
        >
          <Glyph d={PATH.spark} size={12} />
          {reason}
        </p>
      )}

      <p className="mt-3 flex-1 text-[0.86rem] leading-relaxed text-[var(--app-body)]">
        {circle.note}
      </p>

      <p className={`${LABEL} mt-3.5 tracking-[0.12em] text-[var(--app-dim)]`}>
        {circle.members} members · {circle.activity}
      </p>

      <ul className="mt-2.5 flex flex-wrap gap-2">
        {circle.tags.map((t) => (
          <li
            key={t}
            className="rounded-full bg-[var(--cm-stone)] px-3 py-1.5 text-[0.76rem] text-[var(--app-muted)]"
          >
            {t}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--cm-edge)] pt-4">
        {inside && !locked ? (
          <>
            <span className="flex min-h-11 items-center gap-1.5 rounded-full bg-[var(--cm-hold)] px-4 text-[0.78rem] font-semibold text-[var(--cm-hold-ink)]">
              {standing === 'founder' ? 'Open · yours' : 'Open circle'}
              <Glyph d={PATH.arrow} size={13} />
            </span>
            <span className="text-[0.8rem] text-[var(--app-muted)]">
              {standing === 'founder' ? 'You started this' : circle.cadence}
            </span>
          </>
        ) : standing === 'requested' ? (
          <>
            <span className="flex min-h-11 items-center rounded-full bg-[var(--cm-stone)] px-4 text-[0.78rem] font-semibold text-[var(--app-muted)]">
              Waiting
            </span>
            <span className="text-[0.8rem] text-[var(--app-muted)]">
              The founder decides. No hurry on their side.
            </span>
          </>
        ) : (
          <>
            {/* Locked and unlocked wear the same shape. What is behind the
                plan should read as the real control, greyed — not as an
                advertisement standing where the control was. */}
            <button
              type="button"
              onClick={locked ? onUpgrade : onRequest}
              className={`flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[0.78rem] font-semibold transition-colors ${
                locked
                  ? 'bg-[var(--cm-stone)] text-[var(--app-dim)] hover:text-[var(--app-gold-ink)]'
                  : 'border border-[var(--cm-edge-strong)] text-[var(--app-ink)] hover:bg-[rgb(27_23_18/0.05)]'
              }`}
            >
              {locked && <Glyph d={PATH.lock} size={13} />}
              {circle.door === 'open' ? 'Join' : 'Request'} · Plus
            </button>
            <button
              type="button"
              onClick={onRead}
              className="text-[0.8rem] text-[var(--app-muted)] underline-offset-4 hover:text-[var(--app-ink)] hover:underline"
            >
              {circle.secondary}
            </button>
          </>
        )}
      </div>
    </Root>
  )
}

/* ------------------------------------------------------------ the doorway -- */

/** One person asking. Their words, their public post if they pointed at one,
    and two plain verbs. Declining tells them nothing — the room stays closed
    and they can ask again, because a rejection notice is a thing you do to a
    candidate, not to somebody carrying something. */
function RequestRow({
  request,
  onDecide,
  onRead,
}: {
  request: JoinRequest
  onDecide: (id: string, admit: boolean) => void
  onRead: (slug: string) => void
}) {
  return (
    <li className="rounded-[16px] border border-[var(--cm-edge)] bg-[var(--cm-sunken)] p-4">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Handle>{request.handle}</Handle>
        <span className={`${LABEL} tracking-[0.12em] text-[var(--app-dim)]`}>{request.ago}</span>
      </div>

      {request.note && (
        <p className="mt-2 text-[0.84rem] leading-relaxed text-[var(--app-body)]">
          “{request.note}”
        </p>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onDecide(request.id, true)}
          className="flex min-h-10 items-center gap-1.5 rounded-full bg-[var(--app-ink)] px-4 text-[0.76rem] font-semibold text-[var(--app-rail)] transition-opacity hover:opacity-90"
        >
          <Glyph d={PATH.check} size={13} />
          Let them in
        </button>
        <button
          type="button"
          onClick={() => onDecide(request.id, false)}
          className="flex min-h-10 items-center rounded-full border border-[var(--cm-edge-strong)] px-4 text-[0.76rem] font-semibold text-[var(--app-ink)] transition-colors hover:bg-[rgb(27_23_18/0.05)]"
        >
          Not now
        </button>
        {request.slug && (
          <button
            type="button"
            onClick={() => onRead(request.slug!)}
            className="ml-auto text-[0.78rem] font-semibold text-[var(--app-gold-ink)] underline underline-offset-4"
          >
            Read their post
          </button>
        )}
      </div>
    </li>
  )
}

/** Everyone waiting at every door this member holds.

    A panel per circle was fine for one room and wrong for five: somebody with
    four circles and thirty requests got four headings and thirty rows before
    they reached the rooms themselves. So the doorway is a register — one line
    per circle, the number waiting, and how long the one at the front has been
    waiting — and the queue for a room opens only when it is asked for.

    Same register as Yours, and deliberately: both answer "which of my things
    needs me", and a member who has learned to read one has learned both. */
function DoorPanel({
  circles,
  requests,
  onDecide,
  onRead,
  onOpenCircle,
}: {
  /** the rooms this member founded, in card order */
  circles: Circle[]
  requests: JoinRequest[]
  onDecide: (id: string, admit: boolean) => void
  onRead: (slug: string) => void
  /** absent inside a room, where there is nowhere further to go */
  onOpenCircle?: (id: string) => void
}) {
  /* One door needs no register — inside a room there is only ever this room,
     so it opens straight onto the queue. */
  const single = circles.length === 1
  const [openId, setOpenId] = useState<string | null>(single ? circles[0].id : null)
  const [all, setAll] = useState(false)

  const rooms = circles.filter((c) => requests.some((r) => r.circleId === c.id))
  const open = openId ? circles.find((c) => c.id === openId) : undefined
  const forOpen = open ? requests.filter((r) => r.circleId === open.id) : []

  /* Requests are authored newest first, so the last one is the person who has
     been waiting longest. In the built product this is an ordering on the
     timestamp; the column means the same thing either way. */
  const longestWait = (id: string) => requests.filter((r) => r.circleId === id).at(-1)?.ago ?? '—'

  function back() {
    setOpenId(null)
    setAll(false)
  }

  /* ---- the queue for one room ---- */
  if (open) {
    const visible = all ? forOpen : forOpen.slice(0, 3)
    const rest = forOpen.length - visible.length

    return (
      <section className={`${CARD} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {!single && (
              <button
                type="button"
                onClick={back}
                className="mb-1.5 flex min-h-9 items-center gap-1.5 text-[0.76rem] font-semibold text-[var(--app-muted)] transition-colors hover:text-[var(--app-ink)]"
              >
                <Glyph d={PATH.leave} size={13} />
                All requests
              </button>
            )}
            <h2 className={`${DISPLAY} text-[1.05rem] leading-snug text-[var(--app-ink)]`}>
              {forOpen.length === 0
                ? `Nobody is waiting for ${open.name}`
                : `${forOpen.length} ${forOpen.length === 1 ? 'person is' : 'people are'} asking to join ${open.name}`}
            </h2>
          </div>
          <span className={`${LABEL} tracking-[0.12em] text-[var(--app-dim)]`}>You decide</span>
        </div>

        {forOpen.length > 0 && (
          <ul className="mt-4 flex flex-col gap-3">
            {visible.map((r) => (
              <RequestRow key={r.id} request={r} onDecide={onDecide} onRead={onRead} />
            ))}
          </ul>
        )}

        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="min-w-[240px] flex-1 text-[0.74rem] leading-relaxed text-[var(--app-dim)]">
            {forOpen.length === 0
              ? 'Everyone who asked has been answered.'
              : '“Not now” is not sent to them as a refusal. The room stays closed and they can ask again.'}
          </p>
          {rest > 0 && (
            <button
              type="button"
              onClick={() => setAll(true)}
              className="flex min-h-10 items-center rounded-full border border-[var(--cm-edge-strong)] px-4 text-[0.76rem] font-semibold text-[var(--app-ink)] transition-colors hover:bg-[rgb(27_23_18/0.05)]"
            >
              Show {rest} more
            </button>
          )}
          {onOpenCircle && (
            <button
              type="button"
              onClick={() => onOpenCircle(open.id)}
              className="text-[0.78rem] font-semibold text-[var(--app-gold-ink)] underline underline-offset-4"
            >
              Open {open.name}
            </button>
          )}
        </div>
      </section>
    )
  }

  /* ---- the register of doors ---- */
  return (
    <section className={`${CARD} cm-rows overflow-hidden`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 pb-1 pt-5">
        <h2 className={`${DISPLAY} text-[1.05rem] leading-snug text-[var(--app-ink)]`}>
          {requests.length} {requests.length === 1 ? 'person is' : 'people are'} asking to join{' '}
          {rooms.length === 1 ? 'one of your circles' : `${rooms.length} of your circles`}
        </h2>
        <span className={`${LABEL} tracking-[0.12em] text-[var(--app-dim)]`}>You decide</span>
      </div>

      <div
        className={`${LABEL} cm-row cm-row--door cm-rowhead mt-3 border-y border-[var(--cm-edge)] px-5 py-3 tracking-[0.12em]`}
      >
        <span>Circle</span>
        <span>Waiting</span>
        <span>Longest</span>
        <span />
      </div>

      {rooms.map((c) => {
        const n = requests.filter((r) => r.circleId === c.id).length
        return (
          <div
            key={c.id}
            className="cm-row cm-row--door border-b border-[var(--cm-edge)] px-5 py-4 last:border-b-0"
          >
            <div className="min-w-0">
              <p className={`${DISPLAY} text-[0.95rem] leading-snug text-[var(--app-ink)]`}>
                {c.name}
              </p>
              <p className="mt-1 text-[0.74rem] text-[var(--app-dim)]">
                {c.theme} · {c.members} members · {c.door === 'ask' ? 'ask first' : 'open door'}
              </p>
            </div>

            <div>
              <span className={`${DISPLAY} text-[1.05rem] leading-none text-[var(--app-ink)]`}>
                {n}
              </span>
              <span className={`${LABEL} ml-2 tracking-[0.1em] text-[var(--app-gold-ink)]`}>
                {n === 1 ? 'request' : 'requests'}
              </span>
            </div>

            <span className="text-[0.76rem] text-[var(--app-muted)]">{longestWait(c.id)}</span>

            <button
              type="button"
              onClick={() => setOpenId(c.id)}
              aria-label={`Open ${n} ${n === 1 ? 'request' : 'requests'} for ${c.name}`}
              className="flex min-h-10 w-fit items-center gap-1.5 rounded-full border border-[var(--cm-edge-strong)] px-4 text-[0.74rem] font-semibold text-[var(--app-ink)] transition-colors hover:border-[rgb(27_23_18/0.36)] hover:bg-[rgb(27_23_18/0.04)]"
            >
              Open requests
              <Glyph d={PATH.arrow} size={13} />
            </button>
          </div>
        )
      })}

      <p className="px-5 py-4 text-[0.74rem] leading-relaxed text-[var(--app-dim)]">
        Nobody waiting is told where they are in a queue, and “not now” is never sent as a refusal.
      </p>
    </section>
  )
}

/* ------------------------------------------------------------- inside one -- */

/** The room itself. It takes the whole middle column: a circle is a place you
    are in, and leaving the grid of other rooms visible beside it would make it
    look like one more tile that happened to expand. */
function CircleRoom({
  circle,
  plan,
  myHandle,
  requests,
  onDecide,
  onBack,
  onRead,
}: {
  circle: Circle
  plan: Plan
  myHandle: string | undefined
  requests: JoinRequest[]
  onDecide: (id: string, admit: boolean) => void
  onBack: () => void
  onRead: (slug: string) => void
}) {
  const posts = CIRCLE_POSTS[circle.id] ?? []
  const pinned = posts.filter((p) => p.pinned)
  const rest = posts.filter((p) => !p.pinned)

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="flex min-h-10 items-center gap-1.5 text-[0.78rem] font-semibold text-[var(--app-muted)] transition-colors hover:text-[var(--app-ink)]"
      >
        <Glyph d={PATH.leave} size={14} />
        All circles
      </button>

      <section className={`${CARD} mt-2 overflow-hidden`}>
        <div aria-hidden="true" className="h-[7px]" style={{ background: circle.tint }} />
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-[240px] flex-1">
              <h2 className={`${DISPLAY} text-[1.3rem] leading-tight text-[var(--app-ink)]`}>
                {circle.name}
              </h2>
              <p className="mt-2 text-[0.84rem] leading-relaxed text-[var(--app-muted)]">
                {circle.note}
              </p>
            </div>
            <DoorBadge door={circle.door} />
          </div>

          <p className={`${LABEL} mt-3.5 tracking-[0.12em] text-[var(--app-dim)]`}>
            {circle.members} members · {circle.cadence} · {circle.activity}
          </p>

          <ul className="mt-2.5 flex flex-wrap gap-2">
            {circle.tags.map((t) => (
              <li
                key={t}
                className="rounded-full bg-[var(--cm-stone)] px-3 py-1.5 text-[0.76rem] text-[var(--app-muted)]"
              >
                {t}
              </li>
            ))}
          </ul>

          {/* Said inside the room as well as outside it. Somebody who came
              straight here from a card has not read the section copy. */}
          <p className="mt-3.5 border-t border-dashed border-[var(--cm-edge-strong)] pt-3.5 text-[0.76rem] leading-relaxed text-[var(--app-faint)]">
            No clinician in this room and no participation scoring. Every message is filtered for
            harm, as everywhere else. Clinical work stays in Guided Group Care.
          </p>
        </div>
      </section>

      {circle.you === 'founder' && requests.length > 0 && (
        <div className="mt-3">
          {/* One room's doorway. No filter row and no link out — there is
              nowhere further to go from inside the room itself. */}
          <DoorPanel
            circles={[circle]}
            requests={requests}
            onDecide={onDecide}
            onRead={onRead}
          />
        </div>
      )}

      <section className={`${CARD} mt-3 p-5`}>
        <h3 className={`${LABEL} mb-3 tracking-[0.14em]`}>Say something to the room</h3>
        {/* A room, not a wall. Everything said here lands on the people in it,
            so it is checked like a reply — "moderation on any response to any
            post or chat in a group". */}
        <Composer
          plan={plan}
          compact
          surface="message"
          label={`Post to ${circle.name}`}
          placeholder="Nothing has to be finished before you write it."
          submitLabel="Post to the circle"
        />
      </section>

      {pinned.map((p) => (
        <section
          key={p.id}
          className="mt-3 rounded-[20px] border border-[var(--cm-gold-edge)] bg-[var(--cm-gold-wash)] p-5"
        >
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Handle>{p.handle}</Handle>
            <span className={`${LABEL} tracking-[0.12em] text-[var(--app-gold-ink)]`}>
              {p.ago}
            </span>
          </div>
          <p className="mt-2 text-[0.86rem] leading-relaxed text-[var(--app-body)]">{p.text}</p>
        </section>
      ))}

      <div className="mt-3 flex flex-col gap-2.5">
        {rest.map((p) => {
          const mine = p.handle === myHandle
          return (
            <article
              key={p.id}
              className={`${CARD} p-4 ${mine ? 'border-[rgb(224_172_92/0.5)]' : ''}`}
            >
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span
                  aria-hidden="true"
                  className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full text-[0.6rem] font-semibold text-[var(--app-ink)]"
                  style={{ background: tintFor(p.handle) }}
                >
                  {p.handle.charAt(0)}
                </span>
                <Handle>{p.handle}</Handle>
                {mine && (
                  <span className={`${LABEL} tracking-[0.12em] text-[var(--app-gold-ink)]`}>
                    You
                  </span>
                )}
                <span className={`${LABEL} tracking-[0.12em] text-[var(--app-dim)]`}>{p.ago}</span>
              </div>
              <p className="mt-2 text-[0.86rem] leading-relaxed text-[var(--app-body)]">{p.text}</p>
            </article>
          )
        })}
      </div>

      <p className="mt-4 text-[0.74rem] leading-relaxed text-[var(--app-dim)]">
        Leave at any time and the room forgets you — your posts go with you, and nothing about your
        time here is kept or reported.
      </p>
    </>
  )
}

/* ------------------------------------------------------------ starting one -- */

/** Naming the room, saying what it is for, and deciding how many invitations
    go out. The last step is the one that needs care: suggesting people is only
    defensible because it reads posts already public in the feed under those
    handles, points the founder at them to read in full, and produces an
    invitation the other person may ignore. Nobody is told they were matched. */
function NewCircle({
  onCancel,
  onRead,
}: {
  onCancel: () => void
  onRead: (slug: string) => void
}) {
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  /* Suggested words for a circle's topic, from the same list a post is filed
     under. One vocabulary for both, so a circle about money and a post about
     money use the same word. */
  const circleTopics = useCategories()
  const [size, setSize] = useState<number>(CIRCLE_SIZES[1])
  const [invited, setInvited] = useState<string[]>([])
  const [looked, setLooked] = useState(false)
  const [made, setMade] = useState(false)

  const suggestions = useMemo(
    () => (looked ? suggestForCircle(topic, size) : []),
    [looked, topic, size],
  )
  const named = name.trim().length > 1 && topic.trim().length > 2

  if (made) {
    return (
      <section className={`${CARD} cm-rise p-5`}>
        <h2 className={`${DISPLAY} text-[1.2rem] leading-tight text-[var(--app-ink)]`}>
          {name} is open.
        </h2>
        <p className="mt-2 text-[0.84rem] leading-relaxed text-[var(--app-body)]">
          {invited.length === 0
            ? 'No invitations went out. It will show to people carrying the same thing, by the theme and never by you.'
            : `${invited.length} ${invited.length === 1 ? 'invitation' : 'invitations'} sent. Each one is a request the other person may ignore, and they are not told how they were found.`}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="mt-4 flex min-h-11 w-fit items-center rounded-full bg-[var(--app-ink)] px-5 text-[0.78rem] font-semibold text-[var(--app-rail)] transition-opacity hover:opacity-90"
        >
          Back to circles
        </button>
      </section>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={onCancel}
        className="flex min-h-10 items-center gap-1.5 text-[0.78rem] font-semibold text-[var(--app-muted)] transition-colors hover:text-[var(--app-ink)]"
      >
        <Glyph d={PATH.leave} size={14} />
        All circles
      </button>

      <section className={`${CARD} mt-2 p-5`}>
        <h2 className={`${DISPLAY} text-[1.2rem] leading-tight text-[var(--app-ink)]`}>
          Start a circle
        </h2>
        <p className="mt-2 text-[0.82rem] leading-relaxed text-[var(--app-muted)]">
          Three things and it exists. People find it by the shared thing, never by you.
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <div>
            <label
              htmlFor="cm-circle-name"
              className={`${LABEL} block tracking-[0.14em]`}
            >
              What is it called
            </label>
            <input
              id="cm-circle-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sunday phone calls"
              className={`${DISPLAY} mt-2 w-full rounded-[12px] border border-[rgb(27_23_18/0.1)] bg-[var(--cm-sunken)] px-4 py-3 text-[1rem] leading-snug text-[var(--app-ink)] outline-none placeholder:text-[var(--app-dim)] focus-visible:border-[var(--app-gold)]`}
            />
          </div>

          <div>
            <label htmlFor="cm-circle-topic" className={`${LABEL} block tracking-[0.14em]`}>
              What it is about
            </label>
            <p className="mt-1.5 text-[0.76rem] leading-relaxed text-[var(--app-faint)]">
              The issue, the burden, the specific thing. This is what the room is matched on and
              what people read before asking to join.
            </p>
            <textarea
              id="cm-circle-topic"
              value={topic}
              onChange={(e) => {
                setTopic(e.target.value)
                setLooked(false)
              }}
              placeholder="Performing a version of yourself for family every week, and the hour afterwards."
              className="mt-2 min-h-[88px] w-full resize-y rounded-[12px] border border-[rgb(27_23_18/0.1)] bg-[var(--cm-sunken)] p-4 text-[0.88rem] leading-relaxed text-[var(--app-ink)] outline-none placeholder:text-[var(--app-dim)] focus-visible:border-[var(--app-gold)]"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(circleTopics.data ?? []).slice(0, 6).map(({ label: c }) => (
                <Pill
                  key={c}
                  small
                  on={topic.toLowerCase().includes(c.toLowerCase())}
                  onClick={() => {
                    setTopic((t) => (t.toLowerCase().includes(c.toLowerCase()) ? t : `${t} ${c}`.trim()))
                    setLooked(false)
                  }}
                >
                  {c}
                </Pill>
              ))}
            </div>
          </div>

          <div>
            <span className={`${LABEL} block tracking-[0.14em]`}>How many to open with</span>
            <p className="mt-1.5 text-[0.76rem] leading-relaxed text-[var(--app-faint)]">
              Not a target. It is how many invitations go out, and every one of them is a request
              the other person may ignore.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CIRCLE_SIZES.map((n) => (
                <Pill key={n} small on={size === n} onClick={() => setSize(n)}>
                  {n} people
                </Pill>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={!named}
          onClick={() => setLooked(true)}
          className="mt-5 flex min-h-11 w-fit items-center gap-1.5 rounded-full bg-[var(--app-ink)] px-5 text-[0.78rem] font-semibold text-[var(--app-rail)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Glyph d={PATH.spark} size={13} />
          Find {size} people
        </button>
      </section>

      {looked && (
        <section className={`${CARD} cm-rise mt-3 p-5`}>
          <h3 className={`${DISPLAY} text-[1.05rem] leading-snug text-[var(--app-ink)]`}>
            {suggestions.length === 0
              ? 'Nobody matched that yet'
              : `${suggestions.length} ${suggestions.length === 1 ? 'handle' : 'handles'} carrying something close`}
          </h3>

          {/* The disclosure belongs above the list, not under it. Somebody
              about to read these names should already know where they came
              from and what the person on the other end will and will not be
              told. */}
          <p className="mt-2 text-[0.78rem] leading-relaxed text-[var(--app-muted)]">
            Matched on posts already public in the feed under these handles — never a lantern, never
            a private journal, never anything from a session. Read their posts before you invite
            anyone. They are not told they were matched, only that a member invited them.
          </p>

          {suggestions.length === 0 ? (
            <p className="mt-3 text-[0.8rem] leading-relaxed text-[var(--app-faint)]">
              Try naming the thing in more ordinary words. The circle can open with nobody in it —
              people will find it by the shared thing.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2.5">
              {suggestions.map((s) => {
                const on = invited.includes(s.handle)
                return (
                  <li
                    key={s.handle}
                    className="rounded-[16px] border border-[var(--cm-edge)] bg-[var(--cm-sunken)] p-4"
                  >
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <Handle>{s.handle}</Handle>
                      <span className={`${LABEL} tracking-[0.12em] text-[var(--app-dim)]`}>
                        {s.reason}
                      </span>
                    </div>
                    <p className="mt-2 text-[0.84rem] leading-snug text-[var(--app-body)]">
                      “{s.excerpt}”
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setInvited((v) =>
                            v.includes(s.handle)
                              ? v.filter((h) => h !== s.handle)
                              : [...v, s.handle],
                          )
                        }
                        className={`flex min-h-10 items-center gap-1.5 rounded-full px-4 text-[0.76rem] font-semibold transition-colors ${
                          on
                            ? 'bg-[var(--cm-hold)] text-[var(--cm-hold-ink)]'
                            : 'border border-[var(--cm-edge-strong)] text-[var(--app-ink)] hover:bg-[rgb(27_23_18/0.05)]'
                        }`}
                      >
                        {on && <Glyph d={PATH.check} size={13} />}
                        {on ? 'Will invite' : 'Invite'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRead(s.slug)}
                        className="ml-auto text-[0.78rem] font-semibold text-[var(--app-gold-ink)] underline underline-offset-4"
                      >
                        Read their posts in the feed
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[var(--cm-edge)] pt-4">
            <p className="text-[0.78rem] text-[var(--app-muted)]">
              {invited.length === 0
                ? 'You can open it with nobody invited.'
                : `${invited.length} of ${size} invitations ready`}
            </p>
            <button
              type="button"
              onClick={() => setMade(true)}
              className="ml-auto flex min-h-11 items-center rounded-full bg-[var(--app-ink)] px-5 text-[0.78rem] font-semibold text-[var(--app-rail)] transition-opacity hover:opacity-90"
            >
              Open the circle
            </button>
          </div>
        </section>
      )}
    </>
  )
}

/* -------------------------------------------------------------- the list -- */

type CirclesView = { at: 'list' } | { at: 'room'; id: string } | { at: 'new' }

/* Four ways into the same set of rooms. "Suggested" is the only one that is a
   guess about the member rather than a fact about them, so it is never the
   default and never reorders the others — All stays the plain list, in the
   order the rooms are in, one tap away. */
type CircleFilter = 'all' | 'suggested' | 'joined' | 'mine'

const CIRCLE_FILTERS: { id: CircleFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'suggested', label: 'Suggested for you' },
  { id: 'joined', label: 'Joined' },
  { id: 'mine', label: 'Started by you' },
]

function CirclesSection({
  plan,
  myHandle,
  view,
  onView,
  onUpgrade,
  onRead,
}: {
  plan: Plan
  myHandle: string | undefined
  /** lifted, so the rail's "Start your own circle" can reach it */
  view: CirclesView
  onView: (v: CirclesView) => void
  onUpgrade: () => void
  onRead: (slug: string) => void
}) {
  const [filter, setFilter] = useState<CircleFilter>('all')
  /* Standing is held here rather than on each card so that admitting somebody
     from the doorway and the card that reports the room's size cannot fall out
     of step with each other. */
  const [standing, setStanding] = useState<Record<string, CircleStanding>>(() =>
    Object.fromEntries(CIRCLES.map((c) => [c.id, c.you])),
  )
  const [requests, setRequests] = useState<JoinRequest[]>(JOIN_REQUESTS)
  const [admitted, setAdmitted] = useState<Record<string, number>>({})

  const matches = useMemo(() => suggestedCircles(), [])
  const reasonFor = (id: string) => matches.find((m) => m.id === id)?.reason

  function decide(id: string, admit: boolean) {
    const r = requests.find((x) => x.id === id)
    setRequests((v) => v.filter((x) => x.id !== id))
    if (admit && r) setAdmitted((a) => ({ ...a, [r.circleId]: (a[r.circleId] ?? 0) + 1 }))
  }

  function readPost(slug: string) {
    onView({ at: 'list' })
    onRead(slug)
  }

  const sized = CIRCLES.map((c) => ({ ...c, members: c.members + (admitted[c.id] ?? 0) }))

  if (view.at === 'room') {
    const circle = sized.find((c) => c.id === view.id)
    if (circle) {
      return (
        <CircleRoom
          circle={{ ...circle, you: standing[circle.id] }}
          plan={plan}
          myHandle={myHandle}
          requests={requests.filter((r) => r.circleId === circle.id)}
          onDecide={decide}
          onBack={() => onView({ at: 'list' })}
          onRead={readPost}
        />
      )
    }
  }

  if (view.at === 'new') {
    return <NewCircle onCancel={() => onView({ at: 'list' })} onRead={readPost} />
  }

  const founded = sized.filter((c) => standing[c.id] === 'founder')
  const waiting = requests.filter((r) => founded.some((c) => c.id === r.circleId))

  const inFilter = (c: Circle) => {
    const s = standing[c.id]
    if (filter === 'joined') return s === 'member' || s === 'founder'
    if (filter === 'mine') return s === 'founder'
    /* A room already joined is not a suggestion — the member is in it. */
    if (filter === 'suggested') {
      return Boolean(reasonFor(c.id)) && s !== 'member' && s !== 'founder'
    }
    return true
  }

  const counts: Record<CircleFilter, number> = {
    all: sized.length,
    suggested: sized.filter(
      (c) =>
        Boolean(reasonFor(c.id)) &&
        standing[c.id] !== 'member' &&
        standing[c.id] !== 'founder',
    ).length,
    joined: sized.filter((c) => standing[c.id] === 'member' || standing[c.id] === 'founder').length,
    mine: founded.length,
  }

  /* Suggested keeps the match order; every other view keeps the plain one. */
  const shown =
    filter === 'suggested'
      ? matches.flatMap((m) => sized.filter((c) => c.id === m.id && inFilter(c)))
      : sized.filter(inFilter)

  const empty: Record<CircleFilter, string> = {
    all: 'No circles yet.',
    suggested:
      'Nothing matched what you have posted about yet. That is not a verdict on the rooms — post a few more times, or read All and pick one yourself.',
    joined: 'You are not in a circle yet. Any room marked Open takes you straight in.',
    mine: 'You have not started one. The third column has the form.',
  }

  return (
    <>
      <section className={`${CARD} p-5`}>
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-[280px] flex-1">
            <p className={`${LABEL} tracking-[0.16em]`}>Circles · member-run, no clinician</p>
            <h2 className={`${DISPLAY} mt-2.5 text-[1.3rem] leading-tight text-[var(--app-ink)]`}>
              Not therapy. Just people with the same specific problem.
            </h2>
            <p className="mt-2 text-[0.82rem] leading-relaxed text-[var(--app-muted)]">
              Any size, any cadence, no attendance scoring and no participation analysis. The only
              thing running in a circle is the same filter that runs everywhere else on Alaap.
              Clinical work stays in Guided Group Care, under the Groups tab.
            </p>

            <ul className="mt-3.5 flex flex-col gap-2">
              {CIRCLE_TERMS.is.map((t) => (
                <li
                  key={t}
                  className="flex items-start gap-2 text-[0.78rem] leading-snug text-[var(--app-body)]"
                >
                  <span className="mt-px flex-none text-[var(--cm-hold-ink)]">
                    <Glyph d={PATH.check} size={13} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>

          {/* The distinction is on the screen rather than in a help page: a
              member who confused the two would be relying on a clinician who
              is not in the room. Both halves stay in the column at every
              width — this is the one thing on the section nobody may miss. */}
          <div className="min-w-[210px] flex-none rounded-[16px] border border-dashed border-[var(--cm-edge-strong)] bg-[var(--cm-sunken)] p-4">
            <h3 className={`${LABEL} tracking-[0.14em]`}>How it differs</h3>
            <ul className="mt-2.5 flex flex-col gap-2">
              {CIRCLE_TERMS.isNot.map((t) => (
                <li
                  key={t}
                  className="flex items-start gap-2 text-[0.76rem] leading-snug text-[var(--app-muted)]"
                >
                  <span className="mt-px flex-none text-[var(--app-gold-ink)]">
                    <Glyph d={PATH.alert} size={12} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Somebody waiting at a door the member holds the key to is the most
          time-sensitive thing on this section, so it sits above the rooms —
          once, for every circle, however many they have. */}
      {plan === 'plus' && waiting.length > 0 && (
        <div className="mt-3">
          <DoorPanel
            circles={founded}
            requests={waiting}
            onDecide={decide}
            onRead={readPost}
            onOpenCircle={(id) => onView({ at: 'room', id })}
          />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex flex-wrap gap-1.5">
          {CIRCLE_FILTERS.map((f) => (
            <Pill key={f.id} small on={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
              {counts[f.id] > 0 && (
                <span
                  className={`${MONO} text-[0.62rem] ${
                    filter === f.id ? 'text-[var(--app-gold-lit)]' : 'text-[var(--app-dim)]'
                  }`}
                >
                  {counts[f.id]}
                </span>
              )}
            </Pill>
          ))}
        </div>
      </div>

      {/* Said where the shortlist is read, not in a help page. A guess about
          somebody made from their own writing has to show its working. */}
      {filter === 'suggested' && (
        <p className="mt-2.5 text-[0.76rem] leading-relaxed text-[var(--app-faint)]">
          Matched on posts you have made public in the feed — never a lantern, never a private
          journal, never anything from a session or a check-in. Each card says which of your posts
          brought it up. Nobody in these rooms is told you were shown them.
        </p>
      )}

      {shown.length === 0 ? (
        <p className="mt-4 rounded-[16px] border border-dashed border-[var(--cm-edge-strong)] p-5 text-[0.82rem] leading-relaxed text-[var(--app-muted)]">
          {empty[filter]}
        </p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 min-[1560px]:grid-cols-3">
          {shown.map((c) => (
            <CircleCard
              key={c.id}
              circle={c}
              plan={plan}
              standing={standing[c.id]}
              reason={filter === 'suggested' ? reasonFor(c.id) : undefined}
              onUpgrade={onUpgrade}
              onEnter={() => onView({ at: 'room', id: c.id })}
              onRequest={() =>
                setStanding((s) => ({
                  ...s,
                  [c.id]: c.door === 'open' ? 'member' : 'requested',
                }))
              }
              onRead={() => onView({ at: 'room', id: c.id })}
            />
          ))}
        </div>
      )}

      {/* The form lives in the third column. Below 1120 there is no third
          column, so it comes back here rather than becoming unreachable. */}
      <div className="mt-3 min-[1120px]:hidden">
        <StartCirclePanel plan={plan} onUpgrade={onUpgrade} onStart={() => onView({ at: 'new' })} />
      </div>
    </>
  )
}

/** Starting a room. Shown in the rail from 1120 up and in the column below
    it — the same component either way, so the two cannot drift. */
function StartCirclePanel({
  plan,
  onUpgrade,
  onStart,
}: {
  plan: Plan
  onUpgrade: () => void
  onStart: () => void
}) {
  return (
    <section className="rounded-[20px] border border-dashed border-[rgb(27_23_18/0.26)] p-5">
      <h3 className={`${DISPLAY} text-[1.05rem] leading-snug text-[var(--app-ink)]`}>
        Start your own circle
      </h3>
      <p className="mt-2 text-[0.8rem] leading-relaxed text-[var(--app-muted)]">
        Name the shared thing, say what it is about, and pick how many people it opens with. People
        find it by the shared thing, never by you.
      </p>
      <button
        type="button"
        onClick={() => (plan === 'free' ? onUpgrade() : onStart())}
        className="mt-3.5 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-[var(--app-ink)] px-4 text-[0.78rem] font-semibold text-[var(--app-rail)] transition-opacity hover:opacity-90"
      >
        {plan === 'free' && <Glyph d={PATH.lock} size={13} />}
        {plan === 'free' ? 'Requires Interaction Plus' : 'Start one'}
      </button>
    </section>
  )
}

/* --------------------------------------------------------------- yours -- */

/** One of the three figures at the head of the section. The gold one is the
    gap — replies received against replies read — and it is the only number on
    this tab that is allowed to be uncomfortable, because it is counting other
    people's writing sitting unread rather than grading the member. */
function YoursStat({
  label,
  value,
  unit,
  note,
  gold = false,
  action,
}: {
  label: string
  value: number | string
  unit: string
  note?: React.ReactNode
  gold?: boolean
  action?: React.ReactNode
}) {
  return (
    <div
      className={`rounded-[16px] p-5 ${
        gold
          ? 'border border-[var(--cm-gold-edge)] bg-[var(--cm-gold-wash)]'
          : `border border-[var(--cm-edge)] bg-[var(--cm-paper)]`
      }`}
    >
      <h3 className={`${LABEL} tracking-[0.13em] ${gold ? 'text-[var(--app-gold-ink)]' : ''}`}>
        {label}
      </h3>
      <p className="mt-3 flex items-baseline gap-2">
        <span className={`${DISPLAY} text-[1.75rem] leading-none text-[var(--app-ink)]`}>
          {value}
        </span>
        <span
          className={`text-[0.8rem] ${gold ? 'text-[var(--app-gold-ink)]' : 'text-[var(--app-muted)]'}`}
        >
          {unit}
        </span>
      </p>
      {note && (
        <p className="mt-2 text-[0.76rem] leading-relaxed text-[var(--app-muted)]">{note}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

/** One row of the register. Five columns from ~720px of card, stacked below
    that — measured on the card itself rather than the window, because this
    section is two columns wide on one screen and one on the next. */
function YoursRow({
  post,
  onOpen,
  categoryLabel,
}: {
  post: MyPost
  onOpen: () => void
  categoryLabel: (id: string) => string
}) {
  const kind = KINDS.find((k) => k.id === 'post')

  return (
    <div className="cm-row border-b border-[var(--cm-edge)] px-5 py-4 last:border-b-0">
      <div className="min-w-0">
        <p className={`${DISPLAY} text-[0.95rem] leading-snug text-[var(--app-ink)]`}>
          {post.thread.body}
        </p>
        <p className="mt-1 text-[0.74rem] text-[var(--app-dim)]">
          {post.thread.handle} · {categoryLabel(post.thread.categoryId)}
        </p>
      </div>

      <span className={`${LABEL} tracking-[0.1em] text-[var(--app-muted)]`}>{kind?.short}</span>

      <span className="text-[0.76rem] text-[var(--app-muted)]">{post.thread.ago}</span>

      {/* The figure and its split are stacked, never run together on one line:
          "4" beside "2 read" reads as forty-two at a glance. */}
      <div>
        <p className={`${DISPLAY} text-[1.05rem] leading-none text-[var(--app-ink)]`}>
          {post.total}
        </p>
        <p className={`${LABEL} mt-1.5 tracking-[0.1em] text-[var(--app-dim)]`}>
          {post.visible} read
        </p>
      </div>

      {/* One destination, whether or not anything is held. The upgrade ask
          belongs on the post itself, where the held replies are drawn at their
          real size — sending someone to a paywall instead of to their own
          thread was answering a question they had not asked yet.

          Just "Open" in this column: the register runs five columns wide and
          the row already says which post it is, so the longer label was
          repeating the row rather than labelling the button. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open your post from ${post.thread.ago} in the feed`}
        className="flex min-h-10 w-fit items-center gap-1.5 rounded-full border border-[var(--cm-edge-strong)] px-4 text-[0.74rem] font-semibold text-[var(--app-ink)] transition-colors hover:border-[rgb(27_23_18/0.36)] hover:bg-[rgb(27_23_18/0.04)]"
      >
        Open
        <Glyph d={PATH.arrow} size={13} />
      </button>
    </div>
  )
}

type YoursFilter = 'all' | PostKind

function YoursSection({ onOpenPost }: { onOpenPost: (ref: string) => void }) {
  const [filter, setFilter] = useState<YoursFilter>('all')

  const own = useOwnThreads()
  const categories = useCategories()
  const categoryLabel = (id: string) =>
    (categories.data ?? []).find((c) => c.id === id)?.label ?? id

  /* Shaped from what the server returned.

     `held` and `followUps` are gone. They described replies withheld behind the
     free plan's visible-reply limit, and the server does not withhold replies —
     it returns what the member may read. A counter for something that does not
     happen is a claim about the product that is not true. */
  const mine: MyPost[] = (own.data ?? []).map((thread) => ({
    thread,
    total: thread.replyCount,
    visible: thread.replies.length,
  }))
  const total = mine.reduce((n, p) => n + p.total, 0)
  const read = mine.reduce((n, p) => n + p.visible, 0)

  /* "6 journals · 5 burdens" — the breakdown is derived rather than authored,
     so it cannot drift away from the rows underneath it. */
  /* Everything here is a burden post: journals and stories live in the clinical
     vault and are never published to the community. */
  const byKind = KINDS.filter((k) => k.id === 'post')
    .map((k) => ({ k, n: mine.length }))
    .filter((x) => x.n > 0)

  const rows = filter === 'all' || filter === 'post' ? mine : []

  const filters: { id: YoursFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    ...KINDS.map((k) => ({ id: k.id as YoursFilter, label: k.plural })),
  ]

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 min-[1120px]:grid-cols-3">
        <YoursStat
          label="You posted"
          value={mine.length}
          unit={mine.length === 1 ? 'time' : 'times'}
          note={byKind
            .map((x) => `${x.n} ${(x.n === 1 ? x.k.short : x.k.plural).toLowerCase()}`)
            .join(' · ')}
        />
        <YoursStat
          label="People replied"
          value={total}
          unit={total === 1 ? 'time' : 'times'}
          note={total > 0 ? 'across your posts' : 'nobody has replied yet'}
        />
        {/* No "held" figure.

            It counted replies withheld behind the free plan's visible-reply
            limit, and the server withholds none — it returns the replies a
            member may read. A number for something that does not happen is a
            claim about the product, and this one doubled as a reason to pay. */}
        <YoursStat
          label="You've read"
          gold
          value={read}
          unit={`of ${total}`}
          note="Nothing is being held from you."
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className={`${DISPLAY} text-[1.15rem] leading-tight text-[var(--app-ink)]`}>
          Everything you've posted
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <Pill key={f.id} small on={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </Pill>
          ))}
        </div>
        <span className={`${LABEL} ml-auto tracking-[0.1em] text-[var(--app-dim)]`}>
          Newest first
        </span>
      </div>

      <div className={`${CARD} cm-rows mt-3 overflow-hidden`}>
        <div
          className={`${LABEL} cm-row cm-rowhead border-b border-[var(--cm-edge)] px-5 py-3 tracking-[0.12em]`}
        >
          <span>Post</span>
          <span>Type</span>
          <span>Posted</span>
          <span>Responses</span>
          <span />
        </div>

        {rows.length === 0 ? (
          <p className="px-5 py-6 text-[0.8rem] text-[var(--app-faint)]">
            Nothing of that kind yet.
          </p>
        ) : (
          rows.map((p) => (
            <YoursRow
              key={p.thread.ref}
              post={p}
              categoryLabel={categoryLabel}
              onOpen={() => onOpenPost(p.thread.ref)}
            />
          ))
        )}


      </div>
    </>
  )
}

/* ------------------------------------------------------------ the upgrade -- */

function UpgradeDialog({
  onClose,
  onPreviewPlus,
}: {
  onClose: () => void
  onPreviewPlus: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panel.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(27_23_18/0.5)] p-6"
      onClick={onClose}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cm-upgrade-title"
        onClick={(e) => e.stopPropagation()}
        className="cm-rise max-h-[85svh] w-full max-w-[520px] overflow-y-auto rounded-[24px] bg-[var(--cm-paper)] p-6 shadow-[0_30px_70px_rgb(27_23_18/0.35)] outline-none sm:p-7"
      >
        <p className={`${LABEL} tracking-[0.16em] text-[var(--app-gold-ink)]`}>
          Interaction Plus · ₹99 / month
        </p>
        <h2
          id="cm-upgrade-title"
          className={`${DISPLAY} mt-2.5 text-[1.4rem] leading-tight text-[var(--app-ink)]`}
        >
          The replies are already written. They are waiting for you.
        </h2>

        <ul className="mt-5 flex flex-col gap-3.5">
          {PLUS_PERKS.map((p) => (
            <li key={p.title} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="mt-[7px] h-[7px] w-[7px] flex-none rounded-full bg-[var(--app-gold)]"
              />
              <span>
                <span className="block text-[0.86rem] font-semibold leading-snug text-[var(--app-ink)]">
                  {p.title}
                </span>
                <span className="mt-1 block text-[0.78rem] leading-relaxed text-[var(--app-muted)]">
                  {p.body}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <p className={`${LABEL} mt-4 tracking-[0.1em] text-[var(--app-dim)]`}>
          ₹49 with a partner subsidy
        </p>

        <div className="mt-5 flex flex-wrap gap-2.5">
          <Link
            to="/join?plan=plus"
            className="flex min-h-11 flex-1 items-center justify-center rounded-full bg-[var(--app-ink)] px-5 text-[0.8rem] font-semibold text-[var(--app-rail)] transition-opacity hover:opacity-90"
          >
            See Interaction Plus
          </Link>
          <button
            type="button"
            onClick={onPreviewPlus}
            className="flex min-h-11 items-center justify-center rounded-full border border-[var(--cm-edge-strong)] px-5 text-[0.8rem] font-semibold text-[var(--app-ink)] transition-colors hover:bg-[rgb(27_23_18/0.05)]"
          >
            Preview as Plus
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-11 items-center justify-center px-3 text-[0.8rem] font-medium text-[var(--app-faint)] hover:text-[var(--app-ink)]"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- tab -- */

export default function CommunityTab() {
  const [section, setSection] = useState<SectionId>('feed')

  /* Who is signed in, and what their plan permits. Both from the server: the
     handle marks their own posts, and the plan decides every limit on this tab. */
  const session = useSession()
  const myHandle = session.member?.handle
  const entitlements = useEntitlements()
  const ownThreads = useOwnThreads()
  const feedThreads = useThreads(25)

  /* The preview toggle starts from the real plan rather than assuming 'free'.
     It is still a preview and is still labelled as one; what changed is that it
     no longer opens on a claim about somebody's account.

     Read from the journal quota because that is what the tiers actually differ
     on — 0 means the feature is not on this tier at all. */
  const [previewPlan, setPreviewPlan] = useState<Plan | null>(null)
  const serverPlan: Plan = entitlements.data?.quotas.journalEntriesPerMonth === 0 ? 'free' : 'plus'
  const plan = previewPlan ?? serverPlan
  const setPlan = (p: Plan) => setPreviewPlan(p)
  const [promptPresses, setPromptPresses] = useState(0)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  /* The post another section has asked the feed to land on. The counter is
     what lets somebody press the same row twice and be taken there again. */
  const [target, setTarget] = useState<{ ref: string; nonce: number } | null>(null)
  /* Which circle screen is showing. It lives here rather than inside the
     section because the form for starting one is in the third column, and the
     rail cannot reach state held in the middle. */
  const [circlesView, setCirclesView] = useState<CirclesView>({ at: 'list' })

  const ownCount = (ownThreads.data ?? []).length
  const counts: Record<SectionId, string> = {
    feed: `${(feedThreads.data ?? []).length} today`,
    lanterns: 'Write',
    circles: plan === 'plus' ? `${CIRCLES.length} open` : 'Plus',
    mine: `${ownCount} ${ownCount === 1 ? 'post' : 'posts'}`,
  }

  /* Both the prompt and the feed's write button land in the same place, since
     Say it anonymously is the only composer on the tab. */
  function goWrite() {
    setSection('lanterns')
    setPromptPresses((n) => n + 1)
  }

  /* A post has exactly one home. Everything else on the tab links to it. */
  function openPost(ref: string) {
    setSection('feed')
    setTarget((t) => ({ ref, nonce: (t?.nonce ?? 0) + 1 }))
  }

  return (
    <div className="cm-courtyard">
      <div className="mx-auto flex w-full max-w-[940px] flex-wrap items-end justify-between gap-4 min-[1120px]:max-w-[1560px]">
        <div className="min-w-[280px] flex-1">
          <p className="flex items-center gap-2 text-[0.76rem] text-[var(--app-faint)]">
            <span
              aria-hidden="true"
              className="cm-breathe h-1.5 w-1.5 flex-none rounded-full bg-[var(--cm-live)]"
            />
            {WRITING_NOW} people are writing right now
          </p>
          <h1 className={`${DISPLAY} mt-2 text-[clamp(1.5rem,4vw,2rem)] leading-none`}>
            The courtyard
          </h1>
          <p className="mt-2.5 text-[0.82rem] leading-relaxed text-[var(--app-muted)]">
            Say the thing once, out loud, to people who have been where you are. Every word gets a
            safety read while you type — not after.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {/* A preview switch, not a purchase. It is labelled as one so the
              screen never implies the plan changed. */}
          <div className="flex items-center gap-1 rounded-full border border-[var(--cm-edge)] bg-[var(--cm-paper)] p-1">
            <span className={`${LABEL} px-2 tracking-[0.12em]`}>Preview</span>
            {(['free', 'plus'] as Plan[]).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={plan === p}
                onClick={() => setPlan(p)}
                className={`min-h-9 rounded-full px-3.5 text-[0.72rem] transition-colors ${
                  plan === p
                    ? p === 'plus'
                      ? 'bg-[var(--app-gold-lit)] font-semibold text-[#3a2a08]'
                      : 'bg-[var(--app-ink)] font-semibold text-[var(--app-rail)]'
                    : 'font-medium text-[var(--app-muted)]'
                }`}
              >
                {p === 'free' ? 'Free' : 'Interaction Plus'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Nav, then the work, then the reference material — the DOM order is
          also the visual order left to right, so tabbing through the page
          goes where the eye does. */}
      <div className="cm-shell mt-5">
        <SectionNav section={section} onSection={setSection} counts={counts} />

        <main className="mt-4 min-w-0 min-[1120px]:mt-0">
          {section === 'feed' && (
            <FeedSection
              plan={plan}
              myHandle={myHandle}
              onUpgrade={() => setUpgradeOpen(true)}
              onWrite={goWrite}
              target={target}
            />
          )}
          {section === 'lanterns' && (
            <AnonymousSection
              plan={plan}
              myHandle={myHandle}
              onUpgrade={() => setUpgradeOpen(true)}
              onOpenPost={openPost}
              focusSignal={promptPresses}
            />
          )}
          {section === 'circles' && (
            <CirclesSection
              plan={plan}
              myHandle={myHandle}
              view={circlesView}
              onView={setCirclesView}
              onUpgrade={() => setUpgradeOpen(true)}
              onRead={openPost}
            />
          )}
          {section === 'mine' && (
            <YoursSection onOpenPost={openPost} />
          )}
        </main>

        {/* Below 1120 the rail would be a pile of asides between the member
            and the thing they came to do, so it is desktop-only. Nothing in
            it is the only copy of anything — the house rules repeat under the
            nav, and the plan limits are stated on the sections themselves. */}
        <aside className="cm-rail hidden flex-col gap-3 min-[1120px]:flex">
          <PromptRail onUse={goWrite} />
          {/* Starting a circle is a thing you do beside the rooms, not one
              more tile among them — as a card in the grid it competed with
              the rooms it was meant to be an alternative to. It drops back
              into the column below 1120, where there is no rail. */}
          {section === 'circles' && circlesView.at === 'list' && (
            <StartCirclePanel
              plan={plan}
              onUpgrade={() => setUpgradeOpen(true)}
              onStart={() => setCirclesView({ at: 'new' })}
            />
          )}
          {section === 'lanterns' && <LimitsRail plan={plan} />}
          <StatsRail />
          {plan === 'free' && <PlusRail onOpen={() => setUpgradeOpen(true)} />}
        </aside>
      </div>

      {/* The house rules are the one thing in the flanks that has to survive
          the rail disappearing. */}
      <div className="mx-auto mt-5 max-w-[940px] rounded-[16px] border border-dashed border-[var(--cm-edge-strong)] p-4 min-[1120px]:hidden">
        <h2 className={`${LABEL} tracking-[0.16em]`}>House rules</h2>
        <p className="mt-2 text-[0.78rem] leading-relaxed text-[var(--app-muted)]">{HOUSE_RULES}</p>
      </div>

      {upgradeOpen && (
        <UpgradeDialog
          onClose={() => setUpgradeOpen(false)}
          onPreviewPlus={() => {
            setPlan('plus')
            setUpgradeOpen(false)
          }}
        />
      )}
    </div>
  )
}
