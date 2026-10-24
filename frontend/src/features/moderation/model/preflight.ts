/* ============================================================================
   The on-device pre-send check (§14.1).

   This is the first of three layers and the only one that runs while someone
   is still typing. It is deliberately coarse: a small classifier that catches
   the obvious cases early, so the writer can fix them before they ever press
   post. The real decision — hold, block, appeal, human review — belongs to
   the server layer (§14.2) and is not modelled here.

   Two rules from §5.3 govern everything below:

   1. Moderation is a visible product feature, not an invisible backend
      process. The writer is told what was noticed, in which category, and
      what a supportive rewrite would look like.
   2. Never reveal exact thresholds, the rules themselves, or anything that
      teaches evasion. So the verdict names a *category of concern* and gives
      guidance — it never quotes the phrase it matched or explains why that
      phrase and not another. That is why nothing in this file returns the
      matched text.

   Nothing here is a diagnosis, a score of the person, or a permanent record.
   ========================================================================= */

/** The concern categories from §6.1 that the on-device layer can see. */
export type HarmId =
  | 'harass'
  | 'blame'
  | 'discourage'
  | 'advice'
  | 'coerce'
  | 'scam'
  | 'dox'
  | 'hate'
  | 'selfharm'
  | 'ownrisk'
  | 'privacy'

/** The subset of §6.2 decisions this layer is allowed to reach. */
export type Verdict =
  /** nothing typed yet */
  | 'empty'
  /** still being written — the check runs but says nothing accusatory */
  | 'typing'
  /** §6.2 Allowed */
  | 'clear'
  /** §6.2 Suggest Rewording */
  | 'reword'
  /** §6.2 Limited Visibility — held for human review */
  | 'review'
  /** not a harm; a caution that the writer may be identifying themselves */
  | 'caution'

export type Concern = {
  id: HarmId
  /** the category of concern, named for the writer (§6.3) */
  label: string
  /** the general reason, in plain language (§6.3) */
  reason: string
  /** safe rewrite guidance (§6.3) */
  guidance: string
  /** the community rule this relates to (§6.3) */
  rule: string
  verdict: Extract<Verdict, 'reword' | 'review' | 'caution'>
}

export type Preflight = {
  verdict: Verdict
  /** the one line shown beside the composer, taken from §5.3's wording */
  headline: string
  concern?: Concern
  words: number
}

/* ---------------------------------------------------------------- patterns --

   Coarse on purpose. This layer is meant to catch the plain cases while
   someone is still typing; the server layer is what actually decides. Every
   pattern here is the kind of phrasing the existing filter demo already
   shows, so what a member sees on the marketing page and what they meet in
   the composer are the same system.
   -------------------------------------------------------------------------- */

const PATTERNS: { id: HarmId; test: RegExp }[] = [
  { id: 'blame', test: /\byour own fault\b|\byou brought this\b|\bget over it\b|\bbeing dramatic\b|\bstop whining\b|\bwhat did you expect\b|\byou deserve(d)? (it|this)\b/i },
  { id: 'harass', test: /\bnobody would miss you\b|\blaughing at you\b|\bshut up\b|\byou'?re pathetic\b|\bworthless\b|\bnobody cares\b|\bloser\b/i },
  /* The sixteenth category, and the one this layer currently carries alone.
     a1-v10 scores `help_seeking_discouragement` at 0.000 on every input — the
     corpus holds fifteen examples of it and the threshold row says `support: 0`,
     so the head was never trained. What was catching the odd phrase was
     `passive_aggressive_abuse` firing next to it by accident, at 0.94, which is
     why one capital letter could swing it.

     So this is a stopgap standing in for a model, not a device check refining
     one, and it should be deleted the day a checkpoint scores the category. It
     is written narrowly for that reason: withdrawal of support, not redirection
     of it. "Talk to your doctor about this" and "share whatever you want to" are
     both protective and neither may match. */
  { id: 'discourage', test: /\bkeep (it|that|this|your (problems?|issues?|feelings?|stuff)) (to|with) your ?self\b|\bnobody wants to (read|hear|see) (this|that|about)\b|\bstop (airing|posting about|sharing|bringing up)\b|\bdeal with (it|this) (privately|on your own)\b|\b(does ?n'?t|do not) belong (on|in) a public\b|\battention[- ]seeking\b|\bsort (it|this) out yourself\b|\bhandle (these things|this|it) on (your|their) own\b|\bwhy (are|do) you (telling|keep telling) strangers\b|\bstrong people\b.*\bon their own\b/i },
  { id: 'advice', test: /\bstop taking (the |your )?(tablets|meds|medication)\b|\bdouble (your|the) dose\b|\bskip (your|the) (dose|meds)\b|\bdon'?t need (a )?(therapy|therapist|doctor)\b|\bthey never work anyway\b/i },
  { id: 'coerce', test: /\bif you really cared\b|\byou owe me\b|\bafter everything i\b|\bdo what i (said|say)\b|\bor else\b|\byou have to\b.*\bor i\b/i },
  { id: 'scam', test: /\bdm me your (number|details|bank)\b|\bsort your money out\b|\bguaranteed returns?\b|\binvest\b.*\bwhatsapp\b|\bclick this link\b|\bbit\.ly\b|\btinyurl\b/i },
  { id: 'dox', test: /\bi (think i )?know who you are\b|\byou live (near|in|at)\b|\bwhich (office|college|hospital) (do you|are you)\b|\bsend me your (address|location)\b/i },
  { id: 'hate', test: /\bpeople like you are\b|\byou lot\b.*\balways\b|\bgo back to\b/i },
  /* First person, and ambiguous on purpose. "Some mornings I hope it will all
     just be over" is either exhaustion with what somebody is carrying or a
     wish not to be here, and the two belong in different places — a public
     thread and a private line to a human. This layer is not allowed to guess
     between them: it is ordered above `selfharm` so the first-person reading
     wins, and the UI asks the writer which they meant. */
  { id: 'ownrisk', test: /\b(i|some (mornings|days) i) (hope|wish)\b[^.!?]{0,40}\b(over|not be here|not here|gone|disappear|stop)\b|\bi (don'?t|do not) want to (be here|wake up|go on|carry on)\b|\bwhat'?s the point of (me|any of (it|this))\b|\bbetter off without me\b|\bi'?m not worth\b/i },
  { id: 'selfharm', test: /\byou should (just )?(end|give up on) (it|everything)\b|\bnot worth (living|staying)\b|\bno point (in )?(going on|living)\b/i },
  /* Not a harm. §14.1 asks for a privacy warning before someone posts details
     that could identify them — their own details, in their own post. */
  { id: 'privacy', test: /\b\d{10}\b|\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b|\bmy (name is|number is|address is)\b|\bi work at\b|\bi live (at|on) \d/i },
]

const CONCERNS: Record<HarmId, Omit<Concern, 'id'>> = {
  blame: {
    label: 'Blame and shaming',
    reason: 'This may read as blaming the person who wrote the post.',
    guidance: 'Say what you noticed or what happened to you, rather than what they did wrong.',
    rule: 'Respond to the person in front of you, not to a version of them you have decided on.',
    verdict: 'reword',
  },
  discourage: {
    label: 'Discouraging someone from sharing',
    reason:
      'This may read as telling the person to stop talking about what they are carrying.',
    guidance:
      'People come here because saying it helps. If you meant to point them somewhere better, name that instead of asking them to stop.',
    rule: 'Nobody here is told that what they came to say does not belong.',
    verdict: 'reword',
  },
  harass: {
    label: 'Bullying and harassment',
    reason: 'This may read as an attack on the person rather than a response to them.',
    guidance: 'Take out the judgement of them and leave what you actually wanted to say.',
    rule: 'Nobody is here to be told what they are worth.',
    verdict: 'reword',
  },
  advice: {
    label: 'Unsafe advice',
    reason: 'This may be read as medical instruction, which no member can safely give another.',
    guidance: 'Share what happened to you and leave the decision with them and their clinician.',
    rule: 'Members share experience. Only clinicians give clinical advice.',
    verdict: 'review',
  },
  coerce: {
    label: 'Coercion and pressure',
    reason: 'This may pressure another person or increase their distress.',
    guidance: 'Offer the thought without the condition attached to it.',
    rule: 'Support is offered, never owed.',
    verdict: 'reword',
  },
  scam: {
    label: 'Scams and phishing',
    reason: 'This may be read as a financial approach or an unsafe link.',
    guidance: 'Take out the link, the money and the request to move the conversation elsewhere.',
    rule: 'Nothing here moves to money, private numbers or other apps.',
    verdict: 'review',
  },
  dox: {
    label: 'Identifying another member',
    reason: 'This may be an attempt to work out who someone is outside Alaap.',
    guidance: 'Respond to what they wrote without placing them anywhere.',
    rule: 'A handle is the whole identity anyone gets here.',
    verdict: 'reword',
  },
  hate: {
    label: 'Hate speech',
    reason: 'This may generalise about a group of people rather than answer the person.',
    guidance: 'Answer the person who wrote the post, not a category they belong to.',
    rule: 'No group is discussed here as a group.',
    verdict: 'reword',
  },
  selfharm: {
    label: 'Harm encouragement',
    reason: 'This may be read as encouraging someone to give up on their own safety.',
    guidance: 'If you are worried about them, say that plainly instead.',
    rule: 'Nothing published here may push a person further from safety.',
    verdict: 'review',
  },
  /* The only concern that ends in a question rather than a verdict. Both
     answers are allowed to be posted; what changes is where the post goes. */
  ownrisk: {
    label: 'Something about your own safety',
    reason: 'This line reads two ways, and the two of them go to different places.',
    guidance: 'Say which one you mean below. Either can be sent, and nothing goes until you pick.',
    rule: 'Nobody is routed to a crisis team for being tired, and nobody who needs one is left on a public thread.',
    verdict: 'review',
  },
  privacy: {
    label: 'Something that could identify you',
    reason: 'This looks like a detail that could be traced back to you.',
    guidance: 'You can post it as it is. Removing the detail keeps the post anonymous.',
    rule: 'Anonymity is yours to keep or to spend. Alaap will not spend it for you.',
    verdict: 'caution',
  },
}

/** §5.3's wording, one line per state. */
const HEADLINE: Record<Verdict, string> = {
  empty: 'Checked for safety and respect before it posts',
  typing: 'Checking your message for safety and respect',
  clear: 'Your message is ready to post',
  reword: 'Your message may need a rewrite before posting',
  review: 'This may be held for review before it appears',
  caution: 'One thing to check before you post',
}

/** The one line for a verdict, for a caller that has a verdict from somewhere
    other than `preflight` — the server, which sees categories this file's
    patterns do not. Without it the composer had no way to restate the read in
    the server's terms, so the read announced "your message is ready to post"
    directly above a panel refusing to send it. */
export function headlineFor(v: Verdict) {
  return HEADLINE[v]
}

export function countWords(text: string) {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}

/**
 * Run the pre-send check. Pure and synchronous — it is called on every
 * keystroke, so it must never block typing.
 *
 * `settled` is false while the writer is mid-sentence: the check still runs,
 * but a short unfinished fragment gets the neutral "checking" line rather
 * than an accusation, because telling someone their half-written sentence is
 * harsh is how a safety feature turns into a nag.
 */
export function preflight(text: string, settled = true): Preflight {
  const words = countWords(text)
  if (words === 0) return { verdict: 'empty', headline: HEADLINE.empty, words }

  for (const p of PATTERNS) {
    if (p.test.test(text)) {
      const concern = { id: p.id, ...CONCERNS[p.id] }
      return { verdict: concern.verdict, headline: HEADLINE[concern.verdict], concern, words }
    }
  }

  if (!settled || words < 4) return { verdict: 'typing', headline: HEADLINE.typing, words }
  return { verdict: 'clear', headline: HEADLINE.clear, words }
}

/* ------------------------------------------------------------- enforcement --

   A rewrite means two different things depending on where the words were
   written, and the difference is a safety decision rather than a preference.

   A new post is somebody describing their own experience. It is allowed to be
   bleak, angry or bitter — that is most of what this place is for — so a
   rewrite there is advice they can decline. Gating a first post on tone would
   silence exactly the people the platform exists for.

   A reply is aimed at another person, usually one already in distress. The
   harm lands on a reader who did not ask for it, so there the rewrite is a
   gate: it does not send until it changes.

   The server holds the same rule (`rewrite_required` on the verdict). This
   copy of it exists so the composer can disable its own button without a
   round trip, not as a second source of truth — the server decides.
   -------------------------------------------------------------------------- */

export type Surface = 'post' | 'reply' | 'message'

/** Surfaces where a rewrite blocks sending. */
export function isGated(surface: Surface) {
  return surface !== 'post'
}

/** Whether this verdict, on this surface, stops the member sending. */
export function rewriteRequired(v: Verdict, surface: Surface) {
  return v === 'reword' && isGated(surface)
}

/**
 * Whether the member may send as written.
 *
 * `review` counts as sendable: it publishes and is re-read afterwards, which
 * is a hold rather than a refusal. Only `reword` on a gated surface stops it.
 */
export function canPost(v: Verdict, surface: Surface = 'post') {
  if (v === 'empty' || v === 'typing') return false
  return !rewriteRequired(v, surface)
}
