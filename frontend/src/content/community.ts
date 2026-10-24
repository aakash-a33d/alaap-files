import { MEMBER } from './dashboard'
import { ILLUSTRATIVE_THREADS, type Reply, type Thread } from './site'

/* ============================================================================
   The community workspace.

   Four things happen on this tab and they are deliberately different shapes:
   reading the feed, putting something down anonymously, sitting in an
   informal circle, and looking at what came back to you.

   What each plan may do is §5.1 and §5.2 of the architecture, held here as
   data rather than scattered through the components — the whole point of the
   free tier is that its limits are legible, and a limit you have to read the
   JSX to find is not legible.
   ========================================================================= */

export type Plan = 'free' | 'plus'

/* --- What a member can write --------------------------------------------
   A burden, a journal entry, or a short story. They are separated because
   they are read differently: the first wants an answer, the second usually
   does not, and the third is being shown rather than asked about.
   ------------------------------------------------------------------------ */

export type PostKind = 'post' | 'journal' | 'story'

export const KINDS: {
  id: PostKind
  label: string
  /** the one-word form, for chips and stamps where the sentence will not fit */
  short: string
  /** carried rather than derived: "Story" does not pluralise by adding an s */
  plural: string
  blurb: string
  placeholder: string
  /** §5.2 — journals and stories are an Interaction Plus feature */
  plus: boolean
}[] = [
  {
    id: 'post',
    label: 'Something on my mind',
    short: 'Burden',
    plural: 'Burdens',
    blurb: 'A burden put down. Expires in five days.',
    placeholder: 'Start anywhere. The middle of the sentence is fine.',
    plus: false,
  },
  {
    id: 'journal',
    label: 'Journal entry',
    short: 'Journal',
    plural: 'Journals',
    blurb: 'A longer entry. Shared, or kept to yourself.',
    placeholder: 'Today went like this…',
    plus: true,
  },
  {
    id: 'story',
    label: 'Short story',
    short: 'Story',
    plural: 'Stories',
    blurb: 'Something written rather than reported.',
    placeholder: 'She had not opened the second envelope yet…',
    plus: true,
  },
]

/* --- Limits --------------------------------------------------------------
   The burden post is uncapped on every plan. §5.1 puts no length limit on it
   and it would be the wrong thing to cap: the free tier's entire promise is
   that you can say the thing once, safely, and cutting someone off mid-
   sentence about something painful is the worst possible moment to ask them
   for money.

   Journals and stories are the Plus feature, and the free plan gets a real
   taste of them rather than a teaser. See the note in WORD_LIMIT.
   ------------------------------------------------------------------------ */

export const WORD_LIMIT: Record<PostKind, { free: number | null; plus: number | null }> = {
  post: { free: null, plus: null },
  /* 250 rather than 100. A hundred words is three sentences — not an entry,
     just a truncated one, and being cut off there reads as a toll gate rather
     than a sample. At 250 the free member can finish a complete short piece,
     which is what makes the feature feel real enough to pay to keep. The
     upgrade pressure is meant to come from the reply limit below, which is
     the far stronger lever, and from wanting room to write more than once. */
  journal: { free: 250, plus: 4000 },
  story: { free: 250, plus: 4000 },
}

/* --- What is visible on each plan ---------------------------------------
   §5.1: one AI response and two peer replies visible, counting every sub-
   reply. Everything beyond that is accepted, stored, and held — the person
   who wrote it is never told their reply went nowhere, because it did not.
   ------------------------------------------------------------------------ */

export const FREE_VISIBLE_PEERS = 2
export const FREE_VISIBLE_AI = 1

export const PLAN_GATES = {
  allReplies: {
    title: 'See every reply you were sent',
    body: 'Your posts keep collecting responses on the free plan. Interaction Plus opens the ones now held.',
  },
  longform: {
    title: 'Journals and short stories',
    body: `Write past ${WORD_LIMIT.journal.free} words, and keep an entry that does not expire in five days.`,
  },
  circles: {
    title: 'Informal circles',
    body: 'Start a circle around something you are carrying, or take a seat in one.',
  },
} as const

/* --- Informal circles ----------------------------------------------------
   Not Guided Group Care. That is §8: six to eight people, a verified lead
   therapist, four scheduled sessions a month, consent-based AI reflection.
   A circle is the opposite of all of it — any number of people, no clinician,
   no participation analysis, no session summaries, nothing that produces a
   record about a member. It is a room, and the only thing running in it is
   the same safety filter that runs everywhere else on Alaap.

   That distinction is stated on the screen itself rather than in a help page,
   because a member who confuses the two would be relying on a clinician who
   is not there.
   ------------------------------------------------------------------------ */

/** How a circle takes new people.

    `open` — anyone on Plus can walk in.
    `ask` — the founder reads the request first. Every circle can be set to
    this, and a circle with a small number of seats usually is.

    A member's own relationship to the room is separate from that, in `you`:
    whether they are in it, waiting on the founder, or neither. Keeping the two
    apart is what lets an open circle still say "waiting" on the one card. */
export type CircleDoor = 'open' | 'ask'
export type CircleStanding = 'member' | 'founder' | 'requested' | 'none'

export type Circle = {
  id: string
  name: string
  /** the shared issue the circle formed around */
  theme: string
  members: number
  note: string
  cadence: string
  door: CircleDoor
  you: CircleStanding
  /** two or three words about the room's shape — pace, size, what it is for.
      Never a hashtag: these are read, not searched. */
  tags: string[]
  /** the last thing that happened in it, in the room's own terms */
  activity: string
  /** what to do instead of joining. Reading first is always offered; a circle
      whose door is `ask` says who decides. */
  secondary: string
  /** the band across the head of the room — the only thing separating one
      circle from another at a glance, since none of them carry a photograph */
  tint: string
}

export const CIRCLES: Circle[] = [
  {
    id: 'c1',
    name: 'Sunday phone calls',
    theme: 'Family distance',
    members: 17,
    note: 'For anyone who performs a version of themselves for family. One thread a week, no advice unless it is asked for.',
    cadence: 'One thread a week',
    door: 'open',
    you: 'member',
    tags: ['family', 'weekly pace'],
    activity: '4 posts today',
    secondary: 'Read 3 posts first',
    tint: '#dce4d4',
  },
  {
    id: 'c2',
    name: 'Six months, still counting',
    theme: 'Drinking less',
    members: 14,
    note: 'Weekly check-in, no streak counters, nobody keeping score. Started by someone at month seven.',
    cadence: 'Weekly check-in',
    door: 'ask',
    you: 'none',
    tags: ['recovery', '2 spots'],
    activity: 'Active 6h ago',
    secondary: 'Members decide',
    tint: '#e4d9e8',
  },
  {
    id: 'c3',
    name: 'Night shift, awake anyway',
    theme: 'Sleep',
    members: 31,
    note: 'The 3am thread. Big, loud, mostly people keeping each other company until the shift ends. No size cap.',
    cadence: 'Always someone up',
    door: 'open',
    you: 'none',
    tags: ['sleep', 'any size'],
    activity: 'Active now',
    secondary: 'Read 3 posts first',
    tint: '#d6e0e6',
  },
  {
    id: 'c4',
    name: 'First in the family',
    theme: 'Career stress',
    members: 9,
    note: 'First to move out, first to do this job, first with nobody at home to ask about any of it.',
    cadence: 'A few messages a day',
    door: 'ask',
    you: 'founder',
    tags: ['work', 'small room'],
    activity: 'Active 2h ago',
    secondary: 'You started this',
    tint: '#f0dcae',
  },
  {
    id: 'c5',
    name: 'The car park twenty minutes',
    theme: 'Family conflict',
    members: 6,
    note: 'For the ones who sit somewhere quiet after the call before they can go inside. No fixing, just the twenty minutes.',
    cadence: 'Sundays and the day after',
    door: 'ask',
    you: 'founder',
    tags: ['family', 'after the call'],
    activity: 'Active 20m ago',
    secondary: 'You started this',
    tint: '#e8dcd2',
  },
]

/* --- Standing at the door ------------------------------------------------
   A request to join is a message from one person to another, not a form
   submission: the founder sees why someone is asking and in their own words.
   Nothing is scored, and a decline is never reported back as a rejection —
   the circle simply stays closed to them and they can ask again.
   ------------------------------------------------------------------------ */

export type JoinRequest = {
  id: string
  circleId: string
  handle: string
  ago: string
  /** the applicant's own sentence. Optional — nobody is made to plead. */
  note?: string
  /** the public post that shows they are carrying the same thing, if there is
      one. It is theirs and already in the feed; the founder is being pointed
      at it, not handed anything new. */
  slug?: string
}

export const JOIN_REQUESTS: JoinRequest[] = [
  {
    id: 'jr1',
    circleId: 'c4',
    handle: 'SlowTide-2093',
    ago: '3 hours ago',
    note: 'First one in my family to do this job. I mostly want to read for a while before I say anything.',
    slug: 'slowtide-2093-loneliness',
  },
  {
    id: 'jr2',
    circleId: 'c4',
    handle: 'PaperLantern-1174',
    ago: 'Yesterday',
    note: 'Got the promotion and could not tell anyone at home why it did not help.',
    slug: 'paperlantern-1174-career',
  },
  {
    id: 'jr3',
    circleId: 'c4',
    handle: 'NorthWindow-5510',
    ago: 'Yesterday',
    note: 'Nobody at home knows what any of this job involves and I have stopped trying to explain it.',
  },
  {
    id: 'jr4',
    circleId: 'c4',
    handle: 'DimLamp-6627',
    ago: '2 days ago',
  },
  {
    id: 'jr5',
    circleId: 'c5',
    handle: 'AmberFold-7702',
    ago: '40 minutes ago',
    note: 'I do the twenty minutes in a stairwell rather than a car park, but it is the same twenty minutes.',
    slug: 'amberfold-7702-grief',
  },
  {
    id: 'jr6',
    circleId: 'c5',
    handle: 'SaltMarsh-9061',
    ago: '5 hours ago',
    note: 'Sunday call, then the engine off for a while. Would like to be somewhere that does not find that strange.',
  },
]

/* --- Starting one --------------------------------------------------------
   Naming the room, saying what it is about, and deciding how many people it
   opens with. The number is not a target: it is how many invitations go out,
   and every one of them is a request the other person may ignore.
   ------------------------------------------------------------------------ */

export const CIRCLE_SIZES = [3, 5, 8, 12] as const

/** Who is on Interaction Plus. Only Plus members can be in a circle at all
    (§5.2), so only they can be suggested for one. In the built product this is
    the subscription table; here it is a list so the suggestion step has
    something honest to filter on. */
export const PLUS_HANDLES: string[] = [
  'SlowTide-2093',
  'PaperLantern-1174',
  'AmberFold-7702',
  'SaltMarsh-9061',
  'NorthWindow-5510',
  'DimLamp-6627',
]

export type Suggestion = {
  handle: string
  /** why this handle came up, in plain words */
  reason: string
  /** the public post the match was made on — the founder reads it in the feed */
  slug: string
  excerpt: string
}

/* Matching runs over posts that are already public in the feed and nothing
   else: never a lantern (those are unlinkable by design and must stay that
   way), never a journal kept private, never anything from a session or a
   check-in. So this surfaces no fact that the member had not already chosen
   to publish under that handle.

   It is a word overlap here. In the built product it is a server-side
   embedding match — but the rule it enforces is the same one either way, and
   the rule is the part that matters: a suggestion is only ever a pointer to a
   post the founder can go and read, and the person suggested is never told
   they were scored, ranked, or matched at all. They receive an invitation
   from another member, which they may ignore. */

const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'about', 'they', 'have',
  'been', 'what', 'who', 'not', 'but', 'are', 'was', 'you', 'your', 'their',
  'a', 'i', 'it', 'of', 'in', 'to', 'on', 'my', 'me', 'is', 'at', 'as', 'or',
])

function terms(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
}

/**
 * Suggest handles for a new circle, closest match first.
 *
 * `topic` is whatever the founder typed about what the room is for. Scored
 * against each Plus member's public posts: a shared category counts for more
 * than a shared word, because a category was chosen deliberately and a word
 * may be a coincidence.
 */
export function suggestForCircle(topic: string, want: number): Suggestion[] {
  const wanted = terms(topic)
  if (wanted.length === 0) return []

  const scored = PLUS_HANDLES.flatMap((handle) => {
    const posts = ILLUSTRATIVE_THREADS.filter((t) => t.handle === handle)
    if (posts.length === 0) return []

    const ranked = posts
      .map((t) => {
        const inCategory = terms(t.category).filter((w) => wanted.includes(w)).length
        const inWords = terms(`${t.title} ${t.body}`).filter((w) => wanted.includes(w)).length
        return { t, score: inCategory * 4 + inWords }
      })
      .sort((a, b) => b.score - a.score)

    const best = ranked[0]
    if (!best || best.score === 0) return []

    return [
      {
        handle,
        reason: `Posts in ${best.t.category.toLowerCase()} — ${posts.length} ${
          posts.length === 1 ? 'post' : 'posts'
        } in the feed`,
        slug: best.t.slug,
        excerpt: best.t.title,
        score: best.score,
      },
    ]
  })

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, want)
    .map(({ handle, reason, slug, excerpt }) => ({ handle, reason, slug, excerpt }))
}

/* --- Which rooms are worth showing this member first ----------------------
   The same matching, pointed the other way: instead of finding people for a
   room, it finds rooms for a person, scored against what they have already
   posted in the feed under their own handle.

   The same limit applies and for the same reason — public posts only, never a
   lantern and never a private journal — but there is a second one here that
   matters more. A shortlist of rooms is a guess about somebody made from
   their own writing, and if the guess is silent it is a nudge. So every match
   carries the sentence that produced it, the member can see it, and the full
   list of circles is one tap away and never reordered.
   ------------------------------------------------------------------------ */

export type CircleMatch = {
  id: string
  /** why this room came up, in the member's own terms */
  reason: string
}

export function suggestedCircles(): CircleMatch[] {
  const mine = ILLUSTRATIVE_THREADS.filter((t) => t.handle === MEMBER.handle)
  if (mine.length === 0) return []

  return CIRCLES.flatMap((c) => {
    const room = terms(`${c.name} ${c.theme} ${c.note} ${c.tags.join(' ')}`)

    const ranked = mine
      .map((t) => {
        const sharedCategory = terms(t.category).filter((w) => room.includes(w)).length
        const sharedWords = terms(`${t.title} ${t.body}`).filter((w) => room.includes(w)).length
        return { t, score: sharedCategory * 4 + sharedWords }
      })
      .sort((a, b) => b.score - a.score)

    const best = ranked[0]
    if (!best || best.score === 0) return []

    return [
      {
        id: c.id,
        reason: `You have written about ${best.t.category.toLowerCase()}`,
        score: best.score,
      },
    ]
  })
    .sort((a, b) => b.score - a.score)
    .map(({ id, reason }) => ({ id, reason }))
}

/* --- Inside one ----------------------------------------------------------
   A circle is a room, not a feed: one running conversation rather than a set
   of posts each waiting for its own replies. No AI first response here — that
   belongs to a post put in front of strangers, and everyone in a circle has
   already said what they are carrying. The safety filter still runs.
   ------------------------------------------------------------------------ */

export type CirclePost = {
  id: string
  handle: string
  ago: string
  text: string
  /** the founder's opening note, held to the top of the room */
  pinned?: boolean
}

export const CIRCLE_POSTS: Record<string, CirclePost[]> = {
  c1: [
    {
      id: 'c1p0',
      handle: 'NorthWindow-5510',
      ago: 'Pinned',
      pinned: true,
      text: 'One thread a week, put up on Sunday morning. Answer it or do not. Nobody here is going to ask why you were quiet.',
    },
    {
      id: 'c1p1',
      handle: 'SaltMarsh-9061',
      ago: '2 hours ago',
      text: 'Forty minutes today and I only checked the clock twice. I am counting that as the whole win for the week.',
    },
    {
      id: 'c1p2',
      handle: 'AmberFold-7702',
      ago: '4 hours ago',
      text: 'Mine asked about work and I gave the short version again. I have decided the short version is allowed to be the answer.',
    },
    {
      id: 'c1p3',
      handle: 'QuietRiver-4821',
      ago: '5 hours ago',
      text: 'Sat in the car for ten minutes afterwards instead of twenty. Not sure whether that is progress or just a shorter walk to the door.',
    },
  ],
  c4: [
    {
      id: 'c4p0',
      handle: 'QuietRiver-4821',
      ago: 'Pinned',
      pinned: true,
      text: 'Small room on purpose. If you are the first in your family to do the thing you are doing, there is nobody at home to ask, and that is the whole reason this exists.',
    },
    {
      id: 'c4p1',
      handle: 'DimLamp-6627',
      ago: '2 hours ago',
      text: 'Turns out you can be the one everybody is proud of and still have nobody to ask what a probation review is.',
    },
  ],
}

/** What a circle is and is not — shown on the section itself. */
export const CIRCLE_TERMS = {
  is: [
    'Any number of people, formed around one shared thing',
    'Informal — company, not treatment',
    'Every message filtered for bullying and harm, as everywhere else',
    'Leave at any time, and the room forgets you',
  ],
  isNot: [
    'No therapist or psychologist in the room',
    'No AI analysis of who participates or how much',
    'No session summaries and no clinical record',
    'Not a substitute for Guided Group Care',
  ],
} as const

/* --- The member's own posts ----------------------------------------------
   Derived from the feed rather than stored beside it. "Your posts" is a view
   over ILLUSTRATIVE_THREADS filtered to the member's handle, so the reply count on that
   card and the number of replies actually in the thread cannot disagree —
   and the jump from one to the other always lands on something real.

   Only `filtered` is authored: replies the safety layer removed are not in
   the tree by definition, so the count of them has to come from somewhere
   else. In the built product it comes from moderation_verdicts.
   ------------------------------------------------------------------------ */

/** Replies the filter removed before they ever reached the author, by slug. */
const FILTERED: Record<string, number> = {
  'quietriver-4821-family': 1,
  'quietriver-4821-journal': 2,
}

export type MyPost = {
  thread: Thread
  /** every peer reply in the tree, counting sub-replies (§5.1) */
  total: number
  /** how many of them this plan may see */
  visible: number
  /** accepted, stored, and waiting behind the plan limit */
  held: number
  /** removed by the safety filter — nobody sees these */
  filtered: number
  /** replies to replies. Worth separating on the summary: a thread that kept
      going between two other people is a different thing from ten people
      answering the post once each. */
  followUps: number
}

function countReplies(replies: Reply[]): number {
  return replies.reduce((n, r) => n + 1 + countReplies(r.children ?? []), 0)
}

/** Everything below the first level of the tree. */
function countFollowUps(replies: Reply[]): number {
  return replies.reduce((n, r) => n + countReplies(r.children ?? []), 0)
}

export function myPosts(plan: Plan): MyPost[] {
  return ILLUSTRATIVE_THREADS.filter((t) => t.handle === MEMBER.handle).map((thread) => {
    const total = countReplies(thread.replies)
    const visible = plan === 'plus' ? total : Math.min(FREE_VISIBLE_PEERS, total)
    return {
      thread,
      total,
      visible,
      held: total - visible,
      filtered: FILTERED[thread.slug] ?? 0,
      followUps: countFollowUps(thread.replies),
    }
  })
}

/* The post categories used to be listed here — Anxiety, Loneliness, Grief, Trauma
   recovery, Addiction support — and the picker read them from this file.
   Removed, for two reasons that are really one.

   The server refuses every one of those ids: metadata/community/categories.v1.yaml
   replaced the condition list with situations, because a list of diagnoses asks
   somebody to name their illness before they are allowed to speak, and most of the
   people this is for have never been diagnosed. The client is now served the real
   list from /api/community/categories, so there is one vocabulary and it cannot
   drift from what the server will accept.

   Nothing imports this any more. It is gone rather than kept, because a list of
   categories sitting in the content file is exactly the thing somebody reaches for
   next time a picker needs options. */

/* --- Posting anonymously -------------------------------------------------
   One handle, issued once to the account behind a verified mobile number, and
   used for everything that account writes. It is not a name and it is not
   chosen: the member cannot pick a flattering one, cannot mint a fresh one to
   escape a conversation, and cannot run two at once.

   A fresh handle per post was the other option and it is worse here. The whole
   product is threaded — an AI first response, peer replies, follow-ups days
   later — and none of that works if the person who wrote the post cannot be
   recognised as the same person answering underneath it. Stable also means
   accountable: the safety layer is the reason this place is usable, and it has
   nothing to act on if every post arrives from a stranger.

   What the member gets instead is that the handle is the whole identity. It is
   never joined to the mobile number in anything anyone can read, and it never
   appears beside a real name, because there is no real name on file to appear.
   ------------------------------------------------------------------------ */

/** What posting anonymously actually covers, and the single exception to it.
    Stated on the section, because a member deciding whether to write here is
    deciding on the strength of exactly these three sentences. */
export const ANON_TERMS: string[] = [
  'One handle for your account, issued to you rather than chosen. It is the whole identity anyone here gets, and it never appears beside a name.',
  'Your subscription, your sessions and your clinician never see this section, and your number is never shown beside anything you write.',
  'One exception: if the safety read finds real risk, a human on that team can reach you. Nobody else can.',
]

/* --- The courtyard's furniture -------------------------------------------
   The standing text and figures around the four sections. Held here for the
   same reason the plan limits are: a rule or a promise written into the JSX
   is a rule nobody can find.
   ------------------------------------------------------------------------ */

/** Shown under the section list. Three sentences, and the third is the one
    that does the work — most of what goes wrong here is unasked-for advice. */
export const HOUSE_RULES =
  'Nobody gets fixed here. “I don’t know” is a full answer. Advice only when it is asked for.'

/** One question a day, the same one for everybody, and never a notification. */
export const QUIET_PROMPT = 'What did you almost say out loud today?'

/** Counts of things that exist — replies sent, lanterns held, posts unread.
    Not a score and not a streak: nothing here resets, and no figure goes down
    if the member stays away for a week (§7.4). */
export const COURTYARD_STATS: { label: string; value: string }[] = [
  { label: 'Responses you sent', value: '11' },
  { label: 'Lanterns you held', value: '38' },
  { label: 'Posts you have not read', value: '4' },
]

/** Roughly how many people are writing right now. A presence light, not an
    audience figure — it is never counted down, ranked, or notified about. */
export const WRITING_NOW = 23

export const PLUS_PERKS: { title: string; body: string }[] = [
  {
    title: 'Every reply, not the first two',
    body: 'Full threads on all your posts, sub-replies included. The held ones were never discarded.',
  },
  {
    title: `Journals and stories up to ${WORD_LIMIT.journal.plus?.toLocaleString()} words`,
    body: `The free plan caps long-form at ${WORD_LIMIT.journal.free} words, which is a real entry rather than a sample.`,
  },
  {
    title: 'Start or join a circle',
    body: 'Informal, member-run rooms. No therapist, no participation scoring — only the same filter for cruelty.',
  },
]
