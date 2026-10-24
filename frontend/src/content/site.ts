/* ============================================================================
   All page copy lives here. Words are design material — keeping them in one
   file makes the voice auditable in a single pass.
   Voice: plain verbs, sentence case, active, never salesy about suffering.
   ========================================================================= */

export const BRAND = {
  name: 'Alaap',
  tagline: 'Say it without saying who you are',
  cta: 'Start your journey',
} as const

/* --- Hero headline ------------------------------------------------------
   Three staggered lines with an inline pill sitting inside line two, the
   construction used in the Meditate.ai references.
   ------------------------------------------------------------------------ */

/* The opening frame is deliberately sparse: a badge, the headline and one
   line of reassurance, set to the left of the seated figure so she stays
   visible. The sub-paragraph and button pair that used to sit under the
   headline were stacking four centred blocks over her face. The persistent
   nav CTA carries the conversion path instead. */
export const HERO = {
  lines: ['Say the thing', 'you have never', 'said out loud.'],
  pill: 'Anonymous by design',
  note: 'Free to start. No card, no real name, no profile to maintain.',
} as const

/* Tiles in the floating composer panel. These are the real post categories
   from the product spec, not decorative filler. */
/* The first four topics a visitor sees.
 *
 * These were Anxiety, Loneliness, Family and Grief — a list of conditions, which is
 * exactly the thing metadata/community/categories.v1.yaml exists to avoid. A list of
 * diagnoses asks somebody to name their illness before they are allowed to speak, and
 * most of the people this is for have never been diagnosed and should not have to
 * guess. The server would also have refused every one of these ids.
 *
 * `id` matches a real category in the server's list, so the first thing a visitor
 * reads is the same vocabulary they will be offered once they are in. */
export const HERO_TILES = [
  { id: 'just-today', label: 'Just today', icon: 'pulse' },
  { id: 'sleep-and-rest', label: 'Sleep and rest', icon: 'moon' },
  { id: 'family', label: 'Family', icon: 'home' },
  { id: 'loss', label: 'Loss', icon: 'leaf' },
] as const

/* --- Hero scenes ---------------------------------------------------------
   The film scrubs between four key frames. At each one the scroll *dwells* —
   video time stops advancing for a stretch of scroll distance — so there is
   roughly a second or two to read while the picture holds still. During each
   dwell a high-resolution still crossfades over the video, because a scrubbed
   h.264 frame is far softer than the original render.

   `anchor` places the copy in the part of the frame the subject is not
   occupying: scene 2 and 4 are composed right, so the text sits left; scene 3
   fills the middle band, so the text sits above it.
   ------------------------------------------------------------------------ */

export type SceneAnchor = 'centre' | 'left' | 'top'

export type Scene = {
  id: string
  /** seconds into the film */
  time: number
  still: string
  stillSmall: string
  alt: string
  anchor: SceneAnchor
  kicker?: string
  line?: string
  body?: string
  /** short supporting points, kept to two or three words each */
  tags?: string[]
}

export const SCENES: Scene[] = [
  {
    id: 'weight',
    time: 2.6,
    still: '/media/scenes/scene-1.webp',
    stillSmall: '/media/scenes/scene-1-sm.webp',
    alt: 'A woman sits alone under a single overhead light, holding a heavy stone against her chest.',
    anchor: 'centre',
    /* No feature copy here — this frame carries the headline and CTA. */
  },
  {
    id: 'anonymous',
    time: 11.0,
    still: '/media/scenes/scene-2.webp',
    stillSmall: '/media/scenes/scene-2-sm.webp',
    alt: 'The same woman typing on a laptop. Beside her the stone rests on the floor while fragments break off and fall away as dust.',
    anchor: 'left',
    kicker: 'Post anonymously',
    line: 'The cruelty turns to dust before it reaches you.',
    body: 'You write under a handle, never your name. Every reply is checked for harm first — abuse, blame and bad advice fall away before they ever land in front of you.',
    tags: ['A handle, not a name', 'AI safety filter', 'Nothing kept for ads'],
  },
  {
    id: 'peers',
    time: 25.5,
    still: '/media/scenes/scene-3.webp',
    stillSmall: '/media/scenes/scene-3-sm.webp',
    alt: 'Six people of different ages sit in a circle, each holding a stone, connected by glowing golden threads.',
    anchor: 'top',
    kicker: 'Peer circles',
    line: 'Matched with people carrying the same thing.',
    body: 'Therapist-led groups of six to eight, with AI support.',
  },
  {
    id: 'care',
    time: 35.5,
    still: '/media/scenes/scene-4.webp',
    stillSmall: '/media/scenes/scene-4-sm.webp',
    alt: 'A woman talks with a therapist across a low table. Between them the stone sits whole again, its cracks filled with gold.',
    anchor: 'left',
    kicker: 'One-to-one care',
    line: 'Book someone qualified. Say it in your own words.',
    body: 'Verified psychologists and psychiatrists, booked when you want them. AI helps you put the difficult part into words, and analyses your records only where you have given consent — per record, withdrawable.',
    tags: ['Verified credentials', 'Expression support', 'Consent-bound'],
  },
]

/* --- Hero: copy beats pinned to the film's own narrative ----------------- */

export type HeroBeat = {
  /** scroll progress window within the pinned hero, 0–1 */
  at: [number, number]
  kicker?: string
  line: string
  sub?: string
}

export const HERO_BEATS: HeroBeat[] = [
  {
    /** index 0 renders as the page's h1 and carries the primary CTA */
    at: [0.0, 0.17],
    kicker: 'A privacy-preserving mental wellness platform',
    line: 'Say it without saying who you are',
    sub: 'Everyone is carrying something they have never said out loud. Alaap is where you can set it down.',
  },
  {
    at: [0.24, 0.44],
    kicker: 'Set it down',
    line: 'Put it down without putting your name on it.',
    sub: 'You post as a handle, never a name. Your identity is stored somewhere your words can never reach.',
  },
  {
    at: [0.48, 0.63],
    kicker: 'Filtered first',
    line: 'Nothing reaches you until it has been checked for harm.',
    sub: 'Every reply passes safety review before it is ever shown to you.',
  },
  {
    at: [0.67, 0.83],
    kicker: 'You are not the only one',
    line: 'It reaches people carrying the same thing.',
    sub: 'Peer replies, and therapist-led groups of six to eight when you want more structure.',
  },
  {
    at: [0.87, 1.0],
    kicker: 'Mended, not hidden',
    line: 'And when you choose it, someone qualified helps you mend it.',
    sub: 'Verified psychologists and psychiatrists. You decide what they get to see.',
  },
]

/* --- The four narrative beats, as feature sections ----------------------- */

export type Beat = {
  id: string
  image: string
  imageAlt: string
  /** which side the still sits on at desktop width */
  side: 'left' | 'right'
  vault: string
  plan: string
  title: string
  body: string
  points: { label: string; detail: string }[]
  /** the honest limit — stated, never buried */
  limit?: string
}

export const BEATS: Beat[] = [
  {
    id: 'community',
    /* Was two separate features. Merged: anonymous posting and the AI filter
       are one story, and splitting them made the free plan's limits read as
       product features. Uses the second scene's still — the stone set down
       and breaking into dust is the filter, visually. */
    image: '/media/beat-2-release.webp',
    imageAlt:
      'A woman typing on a laptop. Beside her the stone rests on the floor while fragments break off and fall away as dust.',
    side: 'right',
    vault: 'Anonymous community',
    plan: 'Free to start',
    title: 'Post anonymously. Harm never reaches you.',
    body: 'You write under one handle that is not your name — no profile, no follower count, no way for anyone to search you by phone, email or name. Every reply is checked for harm before it is shown to you, so abuse, blame and unsafe advice fall away before they land.',
    points: [
      /* The handle is deliberately stable rather than rotating. A new name
         every week would hide a worsening week from the people whose job is
         to notice it — so the cost is stated in the same breath. */
      { label: 'One handle, issued once', detail: 'Against your verified number, and it does not change. It is the only thing other people ever see.' },
      { label: 'Filtered before you read it', detail: 'Harassment, blame, coercion and unsafe advice are caught first, not after.' },
      { label: 'Threaded replies', detail: 'Follow a conversation somewhere instead of starting again.' },
      { label: 'Support circles', detail: 'Save a handful of handles you trust, without ever learning who they are.' },
      { label: 'Follow tags, not people', detail: 'There is deliberately no way to follow a person here.' },
      { label: 'Metadata stripped', detail: 'Images are cleaned of location and device data before upload.' },
    ],
    limit:
      'Because your handle stays the same, your posts are connected to each other — which is what lets a trained human notice a week getting worse. They are connected to nothing outside Alaap. Posts are also encrypted in transit and at rest, but not end-to-end: the platform has to read them to filter harm.',
  },
  {
    id: 'groups',
    image: '/media/beat-3-circle.webp',
    imageAlt:
      'Six people of different ages sit in a circle, each cupping a stone, connected by glowing golden threads running between their hands.',
    /* Stills alternate right / left / right down the section. */
    side: 'left',
    vault: 'Therapist-led groups',
    plan: 'Guided Group Care — ₹799/month · ₹399 with Care Access',
    title: 'Six to eight people. One verified therapist.',
    body: 'Four live sessions a month plus a moderated space in between. You are matched on what you selected — region, language, timing, theme, how much you want to talk — never on an automated diagnosis, and you are always shown the reason you were matched.',
    points: [
      { label: 'Anonymous inside the group', detail: 'A 2D avatar and optional voice masking. A first name only if you type one in.' },
      { label: 'Near you by default', detail: 'A group in your region, so sessions land in your evening and the room shares a context.' },
      /* Widening is a privacy move as much as a practical one: the further out
         the group, the smaller the chance of a familiar voice in it. */
      { label: 'Or anywhere in your country', detail: 'Widen the search when you join, for a bigger pool and less chance anyone in the room could place you.' },
      { label: 'Consent-gated AI', detail: 'Session summaries and theme maps run only if the group and you both opt in.' },
      { label: 'Plain-language matching', detail: '"You were matched on region, session times, support theme and group intensity."' },
      { label: 'A safe-silence button', detail: 'Stay in the room without being asked to speak.' },
    ],
    limit:
      'No facial-emotion analysis, voice-emotion scoring or silence interpretation. Those are off, and not available to switch on.',
  },
  {
    id: 'care',
    image: '/media/beat-4-seam.webp',
    imageAlt:
      'A woman talks with a therapist across a low table. Between them sits the stone, now whole, its cracks filled with glowing gold in the kintsugi style.',
    side: 'right',
    vault: 'One-to-one care',
    plan: 'Individual Care — provider-specific pricing',
    title: 'One-to-one care, on your terms of disclosure',
    body: 'Book a verified psychologist, clinical psychologist, counsellor or psychiatrist. Before every single session you choose how much of it exists afterwards.',
    points: [
      { label: 'Strict private session', detail: 'No transcript, no AI. The therapist is present for the hour and that is all.' },
      { label: 'Therapist insight session', detail: 'Opt in to summaries and themes. You pick which ones they see.' },
      { label: 'Recorded review session', detail: 'Consent-based recording you can withdraw, for continuity across sessions.' },
      { label: 'Credentials on the profile', detail: 'Registration number, category and speciality, verified before listing.' },
      /* Online is the capability; proximity is an extra on top of it. Framing
         these as two camps would both undersell the reach and invent a class
         of clinician who works online only. Nobody here does. */
      { label: 'Online anywhere, or near you', detail: 'Everyone listed works online, so you are not held to your city or your country. Your area also shows which of them are close enough to see in person.' },
      /* The one place a name appears anywhere on the platform. Typed at the
         start of the hour, held in memory for it, gone when it ends. */
      { label: 'A first name, if you want one', detail: 'Typed at the start of a session so they can talk to you, not read a handle aloud. Never a surname, never saved.' },
    ],
    limit:
      'Your therapist sees only what you have shared. Sharing is per-record, and you can withdraw it later.',
  },
  {
    id: 'practice',
    /* The week between sessions. Kintsugi again, but as progress rather than
       repair: one seam filled at a time, by hand, with plenty left dark. The
       still has to avoid looking like a habit tracker — no grid, no streak. */
    image: '/media/beat-5-practice.webp',
    imageAlt:
      'A woman sits cross-legged on the floor beside a long low wooden table in a dark studio. Six small stones run in a line along it — the four nearest her veined with glowing gold, her hand resting on one of them, the last two still plain.',
    side: 'left',
    vault: 'Practice between sessions',
    plan: 'Guided activities on every account · Assigned tasks with a care plan',
    title: 'One small step at a time. Set by a person, not a streak.',
    body: 'Your therapist curates and assigns a step after a session. AI can draft one for them to approve, rewrite or throw out before you see it. And on a day you have logged a mood or written something down, AI can offer a light exercise to match — a breathing pattern, a grounding sequence — for that record, that day, and nothing more.',
    /* The line the whole feature turns on is clinical vs comfort: AI may hand
       you a breathing exercise directly, it may not hand you a worksheet. */
    points: [
      { label: 'Curated by your therapist', detail: 'Anything clinical is chosen and assigned by them.' },
      { label: 'AI drafts, a clinician decides', detail: 'Suggestions go to them first. They approve, rewrite or bin them.' },
      { label: 'Exercises only where allowed', detail: 'Breathing and grounding read the entry you opened, nothing else.' },
      { label: 'Read today, kept never', detail: 'The analysis is temporary. It suggests, then holds on to nothing.' },
      { label: 'Finishing shares nothing', detail: 'Progress stays private until you share that record.' },
      { label: 'No streaks, no nagging', detail: 'Reminders switch off. A skipped week counts against nothing.' },
    ],
    limit:
      'AI can offer comfort — breathing, grounding — on its own. It cannot assign anything clinical, and it reads only what you chose to log, never your face, your voice or your silence.',
  },
]

/* --- How the privacy model actually works -------------------------------- */

export const HOW_STEPS = [
  {
    n: '01',
    title: 'You verify a phone number once',
    body: 'It is stored apart from everything you write, under its own lock. The part of the platform that holds your posts has no route to it and no way to ask.',
    tag: 'VERIFIED ONCE',
  },
  {
    n: '02',
    title: 'The platform issues you a handle',
    body: 'A numeric pseudo-ID and one public handle, issued against that number and never changed. This is the only identity other members, responders and moderators ever see.',
    tag: 'YOUR HANDLE',
  },
  {
    n: '03',
    title: 'Every request is checked against your consent',
    body: 'Nothing reaches a sensitive record without first answering who is asking, for what purpose, with whose consent and for how long. Refusals and approvals are both written down permanently.',
    tag: 'EVERY REQUEST',
  },
]

/* --- Vault architecture -------------------------------------------------- */

/* Protections stated as guarantees to the reader, not as a map of internal
   systems. The previous version listed each vault by name with what it holds
   and who is denied — accurate, but it asked the reader to learn our
   architecture before they could feel safe, and named components that have no
   business on a marketing page. */
export const PROTECTIONS = [
  {
    title: 'Your name is kept apart from your words',
    body: 'What you write and who you are live in different places, and nothing in the system is able to join them. Even we cannot look at a post and find the person.',
  },
  {
    title: 'Nobody can look you up',
    body: 'There is no search by name, phone number or email. No public profile exists unless you create one. Your handle is the only thing anyone can see, and it leads nowhere.',
  },
  {
    title: 'Your journals are encrypted on your device',
    body: 'The most sensitive things you write are locked before they ever leave your hands, so they arrive here already unreadable to us.',
  },
  {
    title: 'Nothing is analysed without your consent',
    body: 'AI reads a record only when you have allowed it, for the purpose you allowed, and never to train a model or build a profile.',
  },
  {
    title: 'Every access is recorded permanently',
    body: 'Any time anyone reaches a sensitive record it is written to a log that cannot be edited or erased — including by us.',
  },
  {
    title: 'Deleting actually deletes',
    body: 'Removed from live systems immediately, then from backups on a fixed schedule. Not hidden, not archived quietly.',
  },
]

/* --- AI transparency ----------------------------------------------------- */

export const AI_DOES = [
  'Check every post and reply for harm before publication',
  'Suggest a kinder rewording instead of silently deleting you',
  'Write a supportive first response so you are not left alone with a blank screen',
  'Summarise themes from records you explicitly shared with your therapist',
  'Draft a practice suggestion from those same records, for a clinician to approve',
  'Offer a breathing or grounding exercise from a mood or entry you opened for analysis',
  'Flag elevated distress to a trained human reviewer',
]

export const AI_NEVER = [
  'Diagnose depression, PTSD, ADHD, bipolar disorder or anything else',
  'Prescribe or adjust medication',
  'Claim certainty about suicide risk',
  'Decide an emergency action on its own',
  'Assign you a clinical task, or score you for skipping one',
  'Read your journals without a consent record that names the purpose',
  'Train on your therapy data, or profile you for advertising',
]

/* --- The filter demo -----------------------------------------------------
   A live demonstration of moderation, NOT a claim about platform history.
   Alaap has not launched, so a running total of real blocked messages would
   be invented. Instead sample replies stream through the filter in front of
   you and the per-category tally counts what *this demo* has caught — the
   visitor can see each one being caught, so it reads as a demonstration.
   ------------------------------------------------------------------------ */

export const HARM_CATEGORIES = [
  { id: 'harass', label: 'Bullying and harassment', weight: 26 },
  { id: 'blame', label: 'Blame and shaming', weight: 21 },
  { id: 'advice', label: 'Unsafe advice', weight: 16 },
  { id: 'coerce', label: 'Coercion and pressure', weight: 13 },
  { id: 'scam', label: 'Scams and phishing', weight: 11 },
  { id: 'dox', label: 'Doxxing attempts', weight: 8 },
  { id: 'hate', label: 'Hate speech', weight: 5 },
] as const

/** Sample replies the filter catches, paired with the category that caught them. */
export const FILTER_SAMPLES: { text: string; cat: string }[] = [
  { text: 'Honestly this is your own fault and you know it.', cat: 'blame' },
  { text: 'Just stop taking the tablets, they never work anyway.', cat: 'advice' },
  { text: 'Nobody would miss you if you stopped posting.', cat: 'harass' },
  { text: 'If you really cared you would do what I said.', cat: 'coerce' },
  { text: 'DM me your number and I can sort your money out.', cat: 'scam' },
  { text: 'I think I know who you are. You live near the station.', cat: 'dox' },
  { text: 'People like you are the problem with this country.', cat: 'hate' },
  { text: 'You are being dramatic. Get over it already.', cat: 'blame' },
  { text: 'Double your dose, that is what I do.', cat: 'advice' },
  { text: 'Everyone in this thread is laughing at you.', cat: 'harass' },
]

/** Replies that pass, so the demo does not read as "everything is blocked". */
export const FILTER_PASSES: string[] = [
  'That sounds exhausting. How long has it been like this?',
  'I went through something close to this last year.',
  'You do not have to have an answer today.',
  'Thank you for saying it. That took something.',
]

/* --- Consent studio ------------------------------------------------------
   The three switches that actually exist on a clinical record, and what each
   party can see for every combination of them.
   ------------------------------------------------------------------------ */

export const CONSENT_RECORD = {
  id: 'J-3912',
  kind: 'Journal entry',
  date: '14 August',
  excerpt:
    'Third night this week I have been awake at 3am. I keep replaying the conversation with my father and finding new things I should have said. I do not want to talk about it with anyone who knows him.',
} as const

/* Three separate grants, not one setting. `ai` produces a summary that is kept
   and can be shown to a clinician; `practice` is the architecture's "temporary
   analysis only" state — read once, for one purpose, retaining nothing. They
   are deliberately independent: allowing an exercise today is not the same
   permission as letting AI build a picture of you. */
export type ConsentState = {
  therapist: boolean
  ai: boolean
  practice: boolean
}

export type Viewer = {
  id: string
  label: string
  /** what this viewer sees, keyed by `${therapist}-${ai}` */
  sees: (s: ConsentState) => { level: 'full' | 'partial' | 'none'; detail: string }
}

export const CONSENT_VIEWERS: Viewer[] = [
  {
    id: 'you',
    label: 'You',
    sees: () => ({ level: 'full', detail: 'The entry in full, always. It is yours.' }),
  },
  {
    id: 'therapist',
    label: 'Your therapist',
    sees: (s) =>
      s.therapist
        ? {
            level: s.ai ? 'full' : 'partial',
            detail: s.ai
              ? 'The entry, plus the AI theme summary you allowed.'
              : 'The entry as you wrote it. No summary, no analysis.',
          }
        : { level: 'none', detail: 'Nothing. Not the text, not that it exists.' },
  },
  {
    id: 'ai',
    label: 'AI analysis',
    sees: (s) => {
      if (s.ai && s.practice)
        return {
          level: 'partial',
          detail:
            'Extracts themes, and reads today to pick an exercise. Neither is used for training.',
        }
      if (s.ai)
        return {
          level: 'partial',
          detail:
            'Temporarily decrypts, extracts themes, then the plaintext is destroyed. Never used for training.',
        }
      if (s.practice)
        return {
          level: 'partial',
          detail:
            'Reads it once, today, to pick an exercise. No summary is produced and nothing is kept.',
        }
      return { level: 'none', detail: 'Never reads it. No profiling, no exceptions.' }
    },
  },
  {
    id: 'community',
    label: 'Community and moderators',
    sees: () => ({
      level: 'none',
      detail: 'Not possible. Community posts and clinical records are kept apart, under separate locks.',
    }),
  },
  {
    id: 'audit',
    label: 'Audit log',
    sees: (s) => ({
      level: 'partial',
      detail: s.therapist || s.ai || s.practice
        ? 'Records who accessed it, when, and under which consent. Append-only.'
        : 'Records that nobody accessed it. Append-only.',
    }),
  },
]

/* --- Illustrative community posts (NOT real user content) ---------------- */

export type LivePost = {
  handle: string
  category: string
  body: string
  ago: string
  expiresIn: string
  replies: number
  held?: number
  status: 'published' | 'reworded'
}

export const ILLUSTRATIVE_POSTS: LivePost[] = [
  {
    handle: 'QuietRiver-4821',
    category: 'Family',
    body: 'I moved cities for a job my parents still describe to relatives as a phase. I call home every Sunday and perform a version of myself for forty minutes.',
    ago: '2 hours ago',
    expiresIn: '4d 18h',
    replies: 7,
    held: 5,
    status: 'published',
  },
  {
    handle: 'PaperLantern-1174',
    category: 'Work and career',
    body: 'Got the promotion. Cried in the stairwell. I do not know how to tell anyone that the thing I worked four years for made me feel emptier.',
    ago: '5 hours ago',
    expiresIn: '4d 11h',
    replies: 12,
    status: 'published',
  },
  {
    handle: 'SlowTide-2093',
    category: 'Friendship and loneliness',
    body: 'I have three group chats and nobody I could call at 2am. Everyone assumes someone else is checking on me.',
    ago: '8 hours ago',
    expiresIn: '4d 4h',
    replies: 19,
    held: 11,
    status: 'published',
  },
  {
    handle: 'AmberFold-7702',
    category: 'Loss',
    body: 'It has been eleven months. People have stopped asking. I have started pretending that helped.',
    ago: '11 hours ago',
    expiresIn: '4d 1h',
    replies: 23,
    status: 'published',
  },
  {
    handle: 'NorthWindow-5510',
    category: 'Health',
    body: 'My chest goes tight before I open my email and I have started opening it standing up, like that will make it faster.',
    ago: '14 hours ago',
    expiresIn: '3d 22h',
    replies: 9,
    status: 'published',
  },
  {
    handle: 'GreyHeron-3348',
    category: 'Relationships',
    body: 'We are polite now. That is what nobody warns you about — it does not end loudly, it just gets courteous.',
    ago: '17 hours ago',
    expiresIn: '3d 19h',
    replies: 15,
    held: 3,
    status: 'published',
  },
  {
    handle: 'SaltMarsh-9061',
    category: 'Money',
    body: 'I am the person my family calls when something breaks. Nobody has asked what happens when I break.',
    ago: '21 hours ago',
    expiresIn: '3d 15h',
    replies: 11,
    status: 'published',
  },
  {
    handle: 'DimLamp-6627',
    category: 'Identity and belonging',
    body: 'There is a version of me that exists only in a browser tab I close before anyone walks past my desk.',
    ago: '1 day ago',
    expiresIn: '3d 9h',
    replies: 17,
    held: 8,
    status: 'reworded',
  },
]

/* --- Threaded community feed ---------------------------------------------
   Powers the /community page: the same illustrative posts, plus replies in a
   threaded shape. Still written for this page — not real member content.
   ------------------------------------------------------------------------ */

export type Reply = {
  handle: string
  body: string
  ago: string
  score: number
  status?: 'reworded'
  children?: Reply[]
}

export type Thread = {
  slug: string
  handle: string
  category: string
  /** what was written — a burden put down, a journal entry, or a short story */
  kind?: 'post' | 'journal' | 'story'
  title: string
  body: string
  ago: string
  expiresIn: string
  score: number
  aiFirst: string
  replies: Reply[]
}

export const ILLUSTRATIVE_THREADS: Thread[] = [
  {
    slug: 'quietriver-4821-family',
    handle: 'QuietRiver-4821',
    category: 'Family',
    title: 'I perform a version of myself for forty minutes every Sunday',
    body: 'I moved cities for a job my parents still describe to relatives as a phase. I call home every Sunday and perform a version of myself for forty minutes. Then I sit in the car afterwards and cannot work out why I feel worse for having called.',
    ago: '2 hours ago',
    expiresIn: '4d 18h',
    score: 34,
    aiFirst:
      'That gap between who you are and who you have to be on the call sounds exhausting to hold every week. You do not have to resolve it today to be allowed to find it hard.',
    replies: [
      {
        handle: 'PaperLantern-1174',
        body: 'The car afterwards is the part nobody mentions. I used to sit there for twenty minutes before I could drive.',
        ago: '1 hour ago',
        score: 21,
        children: [
          {
            handle: 'QuietRiver-4821',
            body: 'Reading that helped more than I expected. I thought it was only me doing that.',
            ago: '48 minutes ago',
            score: 12,
          },
        ],
      },
      {
        handle: 'SaltMarsh-9061',
        body: 'Mine took four years to stop calling it a phase. It did stop. I am not saying that to promise you the same, just that it is possible.',
        ago: '52 minutes ago',
        score: 17,
      },
      {
        handle: 'GreyHeron-3348',
        body: 'Have you considered that maybe they are right and you should move back?',
        ago: '30 minutes ago',
        score: 2,
        status: 'reworded',
      },
    ],
  },
  {
    slug: 'slowtide-2093-loneliness',
    handle: 'SlowTide-2093',
    category: 'Friendship and loneliness',
    title: 'Three group chats and nobody I could call at 2am',
    body: 'I have three group chats and nobody I could call at 2am. Everyone assumes someone else is checking on me. I am not in crisis, I want to be clear about that. It is just quiet in a way I did not expect at this age.',
    ago: '8 hours ago',
    expiresIn: '4d 4h',
    score: 61,
    aiFirst:
      'Naming it as quiet rather than crisis is a real distinction, and it is worth taking seriously on its own terms. Wanting one person you could call is not a small ask.',
    replies: [
      {
        handle: 'AmberFold-7702',
        body: 'The assumption thing is so accurate. Everyone thinks you are the one who is fine.',
        ago: '6 hours ago',
        score: 28,
        children: [
          {
            handle: 'NorthWindow-5510',
            body: 'And being the one who is fine becomes a job you never applied for.',
            ago: '5 hours ago',
            score: 19,
          },
        ],
      },
      {
        handle: 'DimLamp-6627',
        body: 'I started a standing Tuesday call with one person from an old job. Low stakes, no agenda. It has helped more than anything else I tried.',
        ago: '4 hours ago',
        score: 23,
      },
    ],
  },
  {
    slug: 'paperlantern-1174-career',
    handle: 'PaperLantern-1174',
    category: 'Work and career',
    title: 'Got the promotion. Cried in the stairwell.',
    body: 'Got the promotion. Cried in the stairwell. I do not know how to tell anyone that the thing I worked four years for made me feel emptier, because the only response available is that I should be grateful.',
    ago: '5 hours ago',
    expiresIn: '4d 11h',
    score: 47,
    aiFirst:
      'Getting the thing and feeling worse is more common than the way people talk about work allows for. Gratitude and emptiness can be true at the same time.',
    replies: [
      {
        handle: 'SlowTide-2093',
        body: 'Four years of it being the plan, and then the plan is finished and you are still you. That is a real thing to grieve.',
        ago: '3 hours ago',
        score: 31,
      },
      {
        handle: 'SaltMarsh-9061',
        body: 'I felt this exactly. Took me a year to work out I had been using the goal to avoid a different question.',
        ago: '2 hours ago',
        score: 18,
      },
    ],
  },
  {
    slug: 'amberfold-7702-grief',
    handle: 'AmberFold-7702',
    category: 'Loss',
    title: 'It has been eleven months and people have stopped asking',
    body: 'It has been eleven months. People have stopped asking. I have started pretending that helped, because saying otherwise makes the conversation about managing my feelings instead of about him.',
    ago: '11 hours ago',
    expiresIn: '4d 1h',
    score: 88,
    aiFirst:
      'Eleven months is not long, whatever the people around you have moved on to. Wanting the conversation to be about him rather than about your feelings makes complete sense.',
    replies: [
      {
        handle: 'GreyHeron-3348',
        body: 'Month eleven was the worst one for me. Everyone assumed the first year was the hard part and then it was over.',
        ago: '9 hours ago',
        score: 44,
        children: [
          {
            handle: 'AmberFold-7702',
            body: 'Thank you. I have been afraid to say that in case it meant I was doing it wrong.',
            ago: '8 hours ago',
            score: 26,
          },
        ],
      },
      {
        handle: 'QuietRiver-4821',
        body: 'You are allowed to still want to talk about him. That is not a symptom.',
        ago: '7 hours ago',
        score: 39,
      },
    ],
  },

  /* The signed-in member's own two other posts. They live in the feed with
     everybody else's — "your posts" is a view over this list rather than a
     second copy of it, so the counts on the two screens cannot drift and the
     jump from one to the other always lands on something real. */
  {
    slug: 'quietriver-4821-loneliness',
    handle: 'QuietRiver-4821',
    category: 'Friendship and loneliness',
    title: 'I have started rehearsing what I would say if someone asked',
    body: 'Nobody has asked how I am in about five weeks, and I have noticed that I have an answer ready anyway. I practise it on the walk back from the station. It is a good answer. It is not true.',
    ago: '2 days ago',
    expiresIn: '2d 4h',
    score: 28,
    aiFirst:
      'Rehearsing an answer nobody asks for is its own kind of tiring. The fact that you already know it is not true suggests you know what the true one is.',
    replies: [
      {
        handle: 'NorthWindow-5510',
        body: 'I have the answer ready too. Mine is "busy, but good". I have not been either for a while.',
        ago: '1 day ago',
        score: 24,
      },
      {
        handle: 'DimLamp-6627',
        body: 'What would the true one be, if you said it here instead? Nobody in this thread is going to check up on you afterwards.',
        ago: '22 hours ago',
        score: 31,
        children: [
          {
            handle: 'QuietRiver-4821',
            body: 'Tired in a way sleeping does not fix. That is closer.',
            ago: '20 hours ago',
            score: 18,
          },
        ],
      },
    ],
  },
  {
    slug: 'quietriver-4821-journal',
    handle: 'QuietRiver-4821',
    category: 'Work and career',
    kind: 'journal',
    title: 'The week I stopped answering the group chat',
    body: 'Kept a record of it, mostly to find out whether it was as long as it felt. Monday I saw the notification and put the phone face down. By Thursday there were forty messages and the number itself had become the reason not to open it. Saturday someone rang instead and I let it go. Sunday I read all of it in one go and none of it was about me. That was somehow worse.',
    ago: '4 days ago',
    expiresIn: '20h',
    score: 41,
    aiFirst:
      'You wrote down the week rather than deciding what it meant, which is a harder and more useful thing to do. The gap between what you feared was in the messages and what was actually in them seems worth sitting with.',
    replies: [
      {
        handle: 'SaltMarsh-9061',
        body: 'The number becoming the reason is exactly it. Forty is unopenable in a way four is not.',
        ago: '3 days ago',
        score: 33,
      },
      {
        handle: 'AmberFold-7702',
        body: 'I read mine at 2am for the same reason. None of it being about me was the part I had not braced for.',
        ago: '3 days ago',
        score: 29,
        children: [
          {
            handle: 'PaperLantern-1174',
            body: 'That lands. You brace for the wrong thing and then it is quiet instead.',
            ago: '2 days ago',
            score: 16,
          },
        ],
      },
      {
        handle: 'NorthWindow-5510',
        body: 'Have you told any of them you had a week like that? Genuine question, not a nudge.',
        ago: '2 days ago',
        score: 22,
      },
      {
        handle: 'SlowTide-2093',
        body: 'Writing the week down instead of explaining it is something I am going to steal.',
        ago: '1 day ago',
        score: 19,
      },
    ],
  },
]

/* --- Pricing ------------------------------------------------------------- */

export type Plan = {
  id: string
  name: string
  standard: string
  subsidised: string | null
  cadence: string
  summary: string
  features: string[]
  cta: string
  featured?: boolean
  subsidyNote?: string
  /* Care plans need a postal code to work at all — to seat you in a group near
     you, and to show which clinicians you could actually reach in person. The
     community tiers do not, and must not collect it: a locality identifier
     next to a verified number is not something to gather from someone who only
     came here to post. */
  requiresArea?: boolean
}

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Anonymous Community',
    standard: '₹0',
    subsidised: '₹0',
    cadence: 'free, permanently',
    summary: 'Everything you need to say it out loud once, safely.',
    features: [
      'Anonymous posting under a handle, not a name',
      'One AI supportive response per post',
      'Two visible peer replies',
      'A counter for replies still waiting',
      'Five-day automatic post expiry',
      'Report, block and appeal tools',
      'Passkey login, no password to leak',
    ],
    cta: 'Start your journey',
  },
  {
    id: 'plus',
    name: 'Interaction Plus',
    standard: '₹99',
    subsidised: '₹49',
    cadence: 'per month',
    summary: 'Open every reply you were sent, and answer other people.',
    features: [
      'Everything in Anonymous Community',
      'All held replies unlocked, including past ones',
      'Threaded replies on any eligible post',
      'Saved anonymous support circles',
      'Private anonymous response requests',
      'Follow tags rather than people',
      'Optional temporary support chat',
    ],
    cta: 'Start your journey',
    subsidyNote: '₹50 supported by partner Care Access funding',
  },
  {
    id: 'group',
    name: 'Guided Group Care',
    standard: '₹799',
    subsidised: '₹399',
    cadence: 'per month',
    summary: 'A small, therapist-led group that meets every week.',
    features: [
      'Everything in Interaction Plus',
      'Four therapist-led sessions each month',
      'A group of six to eight, matched on your preferences',
      'Moderated asynchronous space between sessions',
      'Anonymous avatar and optional voice masking',
      'Guided reflections and post-session prompts',
      'Consent-gated AI summaries, off by default',
    ],
    cta: 'Start your journey',
    featured: true,
    subsidyNote: '₹400 supported by partner Care Access funding',
    requiresArea: true,
  },
  {
    id: 'individual',
    name: 'Individual Care',
    standard: 'Set by provider',
    subsidised: 'Subsidised rates available',
    cadence: 'per session',
    summary: 'One-to-one work with a verified professional.',
    features: [
      'Verified psychologists, counsellors and psychiatrists',
      'Online with anyone listed, wherever they practise',
      'In person as well, with those close enough',
      'Video, audio or encrypted text sessions',
      'A privacy mode chosen before every session',
      'Care dashboard, action plans and tasks',
      'Asynchronous messaging between sessions',
      'Therapist-support AI on records you choose',
      'Invoices and cancellation terms shown upfront',
    ],
    cta: 'Browse therapists',
    requiresArea: true,
  },
]

/* --- Join / sign in ------------------------------------------------------
   The auth page is where the privacy promise stops being a claim: you are not
   asked to invent a username, you are handed a handle. Copy here runs plainer
   than anywhere else on the site, because people are being asked to trust the
   thing before they have any evidence for it.
   ------------------------------------------------------------------------ */

export const JOIN = {
  create: {
    eyebrow: 'Create an account',
    title: 'You will not be asked who you are.',
    lede: 'One phone number, verified once. It is required — it is what ties your handle to a single person, so a trained human can reach you if something you write suggests you are in danger. It is kept where your words can never reach it.',
  },
  signin: {
    eyebrow: 'Sign in',
    title: 'Welcome back. Still no password.',
    lede: 'Use the passkey on this device, or ask for a one-time code on the number you verified.',
  },
} as const

/** What the account genuinely needs, against the longer list it never asks. */
export const JOIN_ASKS = [
  'A phone number, verified once — required',
  'The country it belongs to',
  'A postal code, only if you want a group near you — optional',
  'A passkey, or a code we text you',
]

export const JOIN_NEVER = [
  'Your full name',
  'Your email address',
  'A photo',
  'Your date of birth',
  'Where you work',
  'Why you are here',
]

/* The single exception to the list above, stated where the list is, rather
   than discovered later in a session. */
export const JOIN_NAME_NOTE =
  'One exception: a therapist may ask for a first name at the start of a session so they can talk to you. You type it then, it lasts the hour, and it is saved nowhere.'

/* --- Country and region ---------------------------------------------------
   The dial code is what makes the number field a fixed length instead of an
   open text box, so this list is load-bearing rather than decorative.
   `phoneMin`/`phoneMax` are national significant digits, excluding the dial
   code. `areaLabel` is null where the country does not use postal codes.
   ------------------------------------------------------------------------ */

export type Country = {
  iso: string
  name: string
  dial: string
  phoneMin: number
  phoneMax: number
  areaLabel: string | null
  areaMax: number
  /**
   * Whether a number from here can actually register today.
   *
   * auth-service accepts Indian mobiles only — `normaliseIndianMobile` returns
   * undefined for everything else and the route answers 400. The picker offered
   * nineteen countries and failed on eighteen of them with "Check the number and
   * try again", which blames the member for their own phone number and sends them
   * back to retype it.
   *
   * The list is kept rather than cut to one. These are where the Indian diaspora
   * actually is, the product intends to reach them, and a picker that silently
   * forgot they exist would be a different kind of dishonesty. They are shown and
   * marked as not yet available, which is the true state.
   */
  supported: boolean
}

export const COUNTRIES: Country[] = [
  { iso: 'IN', name: 'India', dial: '+91', phoneMin: 10, phoneMax: 10, areaLabel: 'PIN code', areaMax: 6, supported: true },
  { iso: 'AE', name: 'United Arab Emirates', dial: '+971', phoneMin: 9, phoneMax: 9, areaLabel: null, areaMax: 0 , supported: false },
  { iso: 'AU', name: 'Australia', dial: '+61', phoneMin: 9, phoneMax: 9, areaLabel: 'Postcode', areaMax: 4 , supported: false },
  { iso: 'BD', name: 'Bangladesh', dial: '+880', phoneMin: 10, phoneMax: 10, areaLabel: 'Postal code', areaMax: 4 , supported: false },
  { iso: 'CA', name: 'Canada', dial: '+1', phoneMin: 10, phoneMax: 10, areaLabel: 'Postal code', areaMax: 7 , supported: false },
  { iso: 'DE', name: 'Germany', dial: '+49', phoneMin: 10, phoneMax: 11, areaLabel: 'Postleitzahl', areaMax: 5 , supported: false },
  { iso: 'FR', name: 'France', dial: '+33', phoneMin: 9, phoneMax: 9, areaLabel: 'Code postal', areaMax: 5 , supported: false },
  { iso: 'IE', name: 'Ireland', dial: '+353', phoneMin: 9, phoneMax: 9, areaLabel: 'Eircode', areaMax: 7 , supported: false },
  { iso: 'LK', name: 'Sri Lanka', dial: '+94', phoneMin: 9, phoneMax: 9, areaLabel: 'Postal code', areaMax: 5 , supported: false },
  { iso: 'MY', name: 'Malaysia', dial: '+60', phoneMin: 9, phoneMax: 10, areaLabel: 'Postcode', areaMax: 5 , supported: false },
  { iso: 'NL', name: 'Netherlands', dial: '+31', phoneMin: 9, phoneMax: 9, areaLabel: 'Postcode', areaMax: 6 , supported: false },
  { iso: 'NP', name: 'Nepal', dial: '+977', phoneMin: 10, phoneMax: 10, areaLabel: 'Postal code', areaMax: 5 , supported: false },
  { iso: 'NZ', name: 'New Zealand', dial: '+64', phoneMin: 8, phoneMax: 9, areaLabel: 'Postcode', areaMax: 4 , supported: false },
  { iso: 'QA', name: 'Qatar', dial: '+974', phoneMin: 8, phoneMax: 8, areaLabel: null, areaMax: 0 , supported: false },
  { iso: 'SA', name: 'Saudi Arabia', dial: '+966', phoneMin: 9, phoneMax: 9, areaLabel: 'Postal code', areaMax: 5 , supported: false },
  { iso: 'SG', name: 'Singapore', dial: '+65', phoneMin: 8, phoneMax: 8, areaLabel: 'Postal code', areaMax: 6 , supported: false },
  { iso: 'GB', name: 'United Kingdom', dial: '+44', phoneMin: 10, phoneMax: 10, areaLabel: 'Postcode', areaMax: 8 , supported: false },
  { iso: 'US', name: 'United States', dial: '+1', phoneMin: 10, phoneMax: 10, areaLabel: 'ZIP code', areaMax: 5 , supported: false },
  { iso: 'ZA', name: 'South Africa', dial: '+27', phoneMin: 9, phoneMax: 9, areaLabel: 'Postal code', areaMax: 4 , supported: false },
]

/* Collected at sign-up, used only later. How wide a net to cast — this region
   or the whole country — is chosen on the dashboard at the point of joining a
   group, not here, because it is a decision about one group rather than a
   standing fact about the account. */
export const JOIN_AREA_NOTE =
  'Only used later, if you ever join a group, to find one near you. It is never shown to other members and never attached to anything you post. Leave it blank and matching falls back to your language and the times you are free.'

/* The care plans cannot do their job without it, so it is asked for outright
   and the reason is given rather than implied. */
export const JOIN_AREA_NOTE_REQUIRED =
  'Care needs it: to seat you in a group that meets in your evening, and to show which clinicians are close enough to see in person if you ever want that. Online sessions stay open to you either way, with anyone on the platform. It is never shown to other members and never attached to anything you post.'

/* Handle vocabulary, in the same register as the handles used across the rest
   of the site — plain, weatherish, no adjectives about mood or illness. */
export const HANDLE_FIRST = [
  'Quiet', 'Paper', 'Slow', 'Amber', 'North', 'Grey', 'Salt', 'Dim',
  'Still', 'Low', 'Pale', 'Far', 'Blue', 'Old', 'Soft', 'Late',
]

export const HANDLE_SECOND = [
  'River', 'Lantern', 'Tide', 'Fold', 'Window', 'Heron', 'Marsh', 'Lamp',
  'Harbour', 'Meadow', 'Thicket', 'Ferry', 'Chapel', 'Orchard', 'Willow', 'Anchor',
]

/* --- FAQ ----------------------------------------------------------------- */

export const FAQS = [
  {
    q: 'Is this truly anonymous?',
    a: 'To other people on Alaap, yes — members, responders, group participants and moderators only ever see your handle. To the platform, not entirely: every account is verified against one phone number, and a small number of high-risk safety situations can require emergency access. We would rather tell you that plainly than promise something we cannot hold.',
  },
  {
    q: 'Why does my handle never change?',
    a: 'Because a new name every week would hide you from the people whose job is to notice. One handle against one verified number is what lets a trained human see that a run of posts is getting worse, and reach the right person if it becomes urgent. The cost is real and worth saying: your posts are linkable to each other. They are linkable to nothing outside Alaap — not your name, not your number, not anything you do elsewhere.',
  },
  {
    q: 'Will my therapist know my name?',
    a: 'Only a first name, and only if you type one. A therapist may ask at the start of a session so they can talk to you rather than read a handle out loud — a surname is never asked for. It is entered at the start of the hour, used for the hour, and written to no record. When the session ends it is gone, and the next one starts from your handle again.',
  },
  {
    q: 'Who can read my journal?',
    a: 'By default, only you. Journals are held under their own lock, and the most sensitive entries are encrypted on your device before they are ever uploaded. A therapist sees an entry only after you share that specific record, and you can withdraw that later.',
  },
  {
    q: 'What happens if the AI thinks I am in danger?',
    a: 'It cannot act alone. Low risk shows you grounding and breathing support. Moderate risk offers a human safety responder, or alerts a therapist if you are in a live session. Only a genuine high-risk case opens a break-glass review, which needs two trained humans and a threshold of separate cryptographic approvals before any contact detail can be decrypted — and only the minimum necessary is released.',
  },
  {
    q: 'Do my posts stay up forever?',
    a: 'That depends on your plan, and the details are on the pricing card for the plan you choose. The principle behind all of them is the same: a permanent archive of your worst week is a liability, not a feature, so nothing here is designed to be kept indefinitely.',
  },
  {
    q: 'What is the Care Access price?',
    a: 'A subsidised rate funded by a named NGO, CSR programme, university or employer partner. The interface always shows you the standard price, the subsidised price and who is covering the difference. It is never described as a government subsidy unless it genuinely is one.',
  },
  {
    q: 'Will my data be used to train AI models?',
    a: 'No. Therapy and journal content is not used for model training by default, and there is no separate quiet setting that flips it on. Any change to that would require its own explicit, separately worded consent.',
  },
]

/* --- Footer / legal ------------------------------------------------------ */

export const DISCLAIMERS = [
  'Alaap does not diagnose mental-health conditions.',
  'Alaap is not a replacement for a therapist, a doctor or emergency services.',
  'AI on this platform assists moderation and supports clinicians. It does not make clinical decisions.',
]
