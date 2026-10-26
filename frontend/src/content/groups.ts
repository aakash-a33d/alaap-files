/* ============================================================================
   Group care copy and illustrative data — the member's side.

   Same voice as dashboard.ts: plain verbs, sentence case, active. Two rules
   from the architecture shape the numbers below.

   §7.4 — nothing here grades anyone. The figures count things that exist:
   sessions held, tasks marked done, the share of speaking time the member
   actually took. The check-in line is drawn from what the member reported
   about themselves, and the chart says so on its face rather than presenting
   it as a measurement the platform made.

   Attendance is a count, never a streak. Seven sessions attended out of the
   eight in a cycle is a fact about a cycle; it does not reset, missing one
   costs nothing, and no figure anywhere resets to zero to make someone come
   back. The eighth mark is the session that has not happened yet, not a
   failure waiting to happen.
   ========================================================================= */

import type { FaceKey } from '../features/groups/model/avatar'

/* --- Who is in the room --------------------------------------------------
   Eight seats: one therapist and seven members, in seat order round the
   circle. The therapist sits first and is drawn as an initial rather than a
   character — see the note in model/avatar.ts.
   ------------------------------------------------------------------------ */

export type Seat = {
  id: string
  name: string
  /** shown when there is no drawn character — the therapist only */
  initial: string
  role: 'therapist' | 'you' | 'member'
  /** whether this person has their camera on this session */
  camera: boolean
  /** the seat colour, and the tile behind the character */
  colour: string
  /** which flat character they use; the therapist has none */
  face?: FaceKey
  /** the room behind them when the camera is on */
  room?: { a: string; b: string; hair: string; skin: string; top: string }
}

export const SEATS: Seat[] = [
  {
    id: 'osei',
    name: 'Dr. Amara Osei',
    initial: 'A',
    role: 'therapist',
    camera: true,
    colour: 'oklch(0.60 0.12 42)',
    room: {
      a: 'oklch(0.74 0.04 74)',
      b: 'oklch(0.50 0.035 54)',
      hair: 'oklch(0.26 0.02 40)',
      skin: 'oklch(0.60 0.06 48)',
      top: 'oklch(0.40 0.04 250)',
    },
  },
  {
    id: 'wren',
    name: 'Wren',
    initial: 'W',
    role: 'you',
    camera: false,
    colour: 'oklch(0.70 0.085 105)',
    face: 'wren',
  },
  {
    id: 'juniper',
    name: 'Juniper',
    initial: 'J',
    role: 'member',
    camera: true,
    colour: 'oklch(0.70 0.085 150)',
    face: 'juniper',
    room: {
      a: 'oklch(0.72 0.035 142)',
      b: 'oklch(0.48 0.03 150)',
      hair: 'oklch(0.28 0.03 45)',
      skin: 'oklch(0.70 0.06 52)',
      top: 'oklch(0.50 0.05 150)',
    },
  },
  {
    id: 'marlow',
    name: 'Marlow',
    initial: 'M',
    role: 'member',
    /* Camera off, so the circle draws him as his flat character. His seat is
       the one that shows what "camera off shows your avatar, never a blank
       tile" actually looks like — including in the video panel, when it is
       his turn to have the floor. */
    camera: false,
    colour: 'oklch(0.70 0.085 200)',
    face: 'marlow',
  },
  {
    id: 'pip',
    name: 'Pip',
    initial: 'P',
    role: 'member',
    camera: false,
    colour: 'oklch(0.70 0.085 250)',
    face: 'pip',
  },
  {
    id: 'sable',
    name: 'Sable',
    initial: 'S',
    role: 'member',
    camera: true,
    colour: 'oklch(0.70 0.085 300)',
    face: 'sable',
    room: {
      a: 'oklch(0.70 0.035 312)',
      b: 'oklch(0.46 0.03 300)',
      hair: 'oklch(0.40 0.06 300)',
      skin: 'oklch(0.54 0.055 42)',
      top: 'oklch(0.42 0.05 300)',
    },
  },
  {
    id: 'fennel',
    name: 'Fennel',
    initial: 'F',
    role: 'member',
    camera: false,
    colour: 'oklch(0.70 0.085 340)',
    face: 'fennel',
  },
  {
    id: 'corvo',
    name: 'Corvo',
    initial: 'C',
    role: 'member',
    camera: false,
    colour: 'oklch(0.70 0.085 65)',
    face: 'corvo',
  },
]

/** Who speaks, in order, when the circle is left to run itself. -1 is the
    quiet beat: silence is a state the room is often in and the circle says so
    rather than holding the last speaker in the middle indefinitely. */
export const SPEAKING_CYCLE = [0, 3, 6, 1, 4, -1, 2]

/* --- The group you are in ------------------------------------------------ */

export const GROUP = {
  /** Which group this is, for anything kept per group (the member's name in it).
      A new cycle is a new group and gets a new id. */
  id: 'health-anxiety-2026-c3',
  title: 'Living with health anxiety',
  /* When it meets is not written down here — see nextSessionAt below. A
     string and a countdown eventually disagree, and the string always wins
     the argument on screen while being the one that is wrong. */
  length: '90 minutes',
  position: 'Session 3 of 4',
  therapist: 'Dr. Amara Osei',
  credential: 'clin. psych · 11 yrs',
  members: 7,
  closed: 'The same seven people every week. No one new joins mid-cycle.',
  question: 'What did your body do before your mind caught up?',
  /** how the member joins unless they change it before the session */
  presence: 'voice only',
} as const

/* --- When the group actually meets --------------------------------------
   The countdown runs off a real moment rather than three written-down
   figures, so the card cannot sit there claiming two days when it is
   Tuesday evening. Tuesdays at 7pm, ninety minutes, every week.
   ------------------------------------------------------------------------ */

export const SESSION_MINUTES = 90
/** Tuesday. `Date#getDay` counts from Sunday. */
const SESSION_WEEKDAY = 2
const SESSION_HOUR = 19

/** The session this member is next in — which stays *this* week's session
    while it is still running, so somebody who joins late is still joining the
    thing that is happening rather than being pointed at next Tuesday. */
export function nextSessionAt(from: Date = new Date()): Date {
  const at = new Date(from)
  at.setHours(SESSION_HOUR, 0, 0, 0)
  at.setDate(at.getDate() + ((SESSION_WEEKDAY - at.getDay() + 7) % 7))
  if (from.getTime() > at.getTime() + SESSION_MINUTES * 60_000) {
    at.setDate(at.getDate() + 7)
  }
  return at
}

/** `Tue 1 Sep · 7:00 pm` — the line under the group's name, formatted from
    the same moment the countdown counts to. */
export function formatSessionTime(at: Date): string {
  const day = at
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/,/g, '')
  const time = at
    .toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\s/g, ' ')
  return `${day} · ${time}`
}

/* --- Where the member stands with group care -----------------------------
   Two separate facts, and they gate different things. Whether the plan
   includes group care decides whether the setup screens are reachable at
   all; whether the setup was ever finished decides whether joining a first
   session has to stop and ask. Somebody can be subscribed and unprepared,
   which is exactly the case the gate exists for.
   ------------------------------------------------------------------------ */

export const GROUP_ACCESS: {
  subscribed: boolean
  /** name, camera and voice chosen, and an avatar built */
  setupComplete: boolean
  /** what unlocks it, quoted from the plan list */
  plan: string
} = {
  subscribed: true,
  setupComplete: false,
  plan: 'Guided Group Care',
}

/* --- How it's going ------------------------------------------------------
   The member's own weekly check-in, read back as one figure. The caption
   under it names whose number it is and where it came from, because a bare
   percentage on a therapy dashboard reads as a grade unless it says
   otherwise on the same line.
   ------------------------------------------------------------------------ */

export const PROGRESS = {
  eyebrow: 'how it’s going',
  heading: 'Eight weeks in',
  figure: '−31',
  unit: '%',
  caption: 'self-reported anxiety, weekly check-in',
  run: 'Seven sessions in a row.',
  aside: 'Showing up is most of it.',
} as const

export const GREETING = {
  line: 'Good evening, Wren.',
  note: 'Two sessions left this month. One task waiting.',
} as const

/* --- Between-session work ------------------------------------------------ */

export type GroupTask = {
  id: string
  title: string
  /** the sentence under the title, on the one that is still open */
  note?: string
  done: boolean
  /** the day it was finished, or when it is wanted */
  when: string
  /** whose task it is */
  scope: string
  /** open tasks the therapist set for this member specifically */
  mine?: boolean
}

export const TASKS: GroupTask[] = [
  {
    id: 'gt1',
    title: 'Log three body-check moments',
    done: true,
    when: 'FRI',
    scope: 'Whole group',
  },
  {
    id: 'gt2',
    title: "Read Juniper's reframe and reply",
    done: true,
    when: 'SAT',
    scope: 'Whole group',
  },
  {
    id: 'gt3',
    title: 'Write the letter to your 19-year-old self',
    note: 'Private unless you choose to read it aloud',
    done: false,
    when: 'DUE TUE',
    scope: 'You · Dr. Osei',
    mine: true,
  },
]

/** Set during the session itself, and still there when it ends. */
export const IN_SESSION_TASKS = [
  {
    id: 'st1',
    title: 'Name the sensation before you name the fear',
    scope: 'Everyone · this week',
    mine: false,
  },
  {
    id: 'st2',
    title: 'Bring one paragraph of the letter to read',
    scope: 'For you · next session',
    mine: true,
  },
] as const

/* --- The task space ------------------------------------------------------ */

export const TASK_SPACE = {
  done: 14,
  total: 18,
  open: {
    title: 'Write the letter to your 19-year-old self',
    assigned: 'Assigned session 2 · Dr. Osei',
    due: 'assigned in session 2 · due tue 4 sep',
    saved: 'DRAFT SAVED 2H AGO',
    brief:
      "Not a summary of what happened. Write to them the way you'd talk to someone in the group — and notice where you start explaining yourself.",
    draft:
      'You were right that something was wrong. You were wrong about what it was, and you spent four years proving it —',
    words: 124,
  },
  groupTask: {
    title: 'Name the sensation before you name the fear',
    progress: 'Whole group · 3 of 7 done',
  },
  finished: [
    { id: 'f1', title: 'Log three body-check moments', when: 'FRI' },
    { id: 'f2', title: "Read Juniper's reframe and reply", when: 'SAT' },
    { id: 'f3', title: 'One week of sleep notes', when: 'W2' },
  ],
  /* The two sharing choices, and the reason each default is what it is. */
  sharing: [
    {
      id: 'group',
      title: 'Share with the group',
      on: false,
      body: 'Off — nobody but you sees the text. You can still choose to read part of it aloud.',
    },
    {
      id: 'therapist',
      title: 'Let Dr. Osei read it first',
      on: true,
      body: "On — she'll read it before Tuesday and may ask you about one line.",
    },
  ],
  footnote:
    "Nothing here is scored. Marking it done just tells Dr. Osei you're ready to talk about it.",
} as const

/* --- Reports -------------------------------------------------------------
   Four readings, none of them a grade. The line chart is what the member
   reported about themselves week to week; the radar is the shape of their own
   participation against their own first cycle, never against other members.
   ------------------------------------------------------------------------ */

/** Weekly self-report, weeks 1–8, on a 0–100 scale of the member's own — 100
    is the strongest they have ever marked either line, not a clinical
    maximum, and the chart says as much on its face. Both series are drawn so
    that higher is more of the thing named: anxiety falling and mood rising is
    what these eight weeks looked like. */
export const CHECK_IN = {
  weeks: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'],
  anxiety: [87, 76, 85, 51, 59, 31, 38, 19],
  mood: [23, 28, 24, 46, 41, 65, 58, 76],
  /** the week worth explaining, and what happened in it */
  marker: 3,
  note: "Week 4 is the drop everyone asks about. That's the session you spoke first. It didn't hold on week 6 — that's normal, and it came back.",
} as const

/** Five axes, this cycle against the member's own first cycle. 0–1. */
export const SHAPE = {
  axes: [
    'Speaking time',
    'Responding to others',
    'Tasks completed',
    'Openness (self-rated)',
    'Attendance',
  ],
  now: [0.84, 0.9, 0.68, 0.62, 0.78],
  before: [0.56, 0.6, 0.48, 0.46, 0.5],
} as const

/** Sessions held in the cycle, and whether the member was in the room. The
    last one has not happened yet — it is drawn open, not missed. */
export type Reading = {
  label: string
  value: string
  /** 0–1, drawn as a bar. A proportion of something countable, never a mark. */
  fill: number
  tone: 'green' | 'terra'
  /** the figure that stops the reading being taken as a grade */
  note?: string
}

export const ATTENDANCE: {
  attended: number
  held: number
  cycle: number
  lines: Reading[]
} = {
  attended: 7,
  held: 7,
  cycle: 8,
  lines: [
    { label: 'Tasks completed', value: '14 / 18', fill: 0.78, tone: 'green' },
    { label: 'Spoke unprompted', value: '5 / 7 sessions', fill: 0.71, tone: 'green' },
    { label: 'Replied to another member', value: '6 / 7 sessions', fill: 0.86, tone: 'green' },
    {
      label: 'Share of group speaking time',
      value: '13%',
      fill: 0.13,
      tone: 'terra',
      note: "an even share would be 14% — you're right there",
    },
  ],
}

export type Moment = { id: string; when: string; quote: string; tone: 'terra' | 'green' | 'dim' }

export const MOMENTS: Moment[] = [
  {
    id: 'm7',
    when: 'session 7 · this week',
    quote: 'Volunteered first. Held a pause instead of filling it.',
    tone: 'terra',
  },
  {
    id: 'm5',
    when: 'session 5',
    quote: 'Named the jaw tension without being asked twice.',
    tone: 'green',
  },
  {
    id: 'm2',
    when: 'session 2',
    quote: 'Camera off, voice steady. Answered every question with a question.',
    tone: 'dim',
  },
]

export type WorkOn = {
  id: string
  flag: string
  title: string
  body?: string
  state: 'open' | 'closed'
}

export const WORK_ON: WorkOn[] = [
  {
    id: 'w1',
    flag: 'still there',
    title: 'Ending your own thoughts with a question mark.',
    body: 'It hands the group the job of agreeing with you. Try stopping at the full stop.',
    state: 'open',
  },
  {
    id: 'w2',
    flag: 'new this cycle',
    title: 'You disappear on the weeks you miss a task.',
    body: 'Come anyway. Unfinished is a thing worth saying out loud.',
    state: 'open',
  },
  {
    id: 'w3',
    flag: 'closed',
    title: 'Waiting to be asked before speaking.',
    state: 'closed',
  },
]

export const REPORT_FOOTNOTE =
  "Session summaries are drafted from Dr. Osei's own notes and released only once she's approved them."

export const LATEST_NOTE =
  'Wren volunteered first this week — a real shift. Still tends to end thoughts with a question.'

/* --- Groups with a seat -------------------------------------------------- */

export type Match = {
  id: string
  title: string
  /** how many seats are open, and whether that is the last one */
  seats: string
  urgent: boolean
  /** when it starts, or that it is already running */
  status: string
  blurb: string
  therapist: string
  credential: string
  /** the therapist's placeholder colour until a real portrait is dropped in */
  colour: string
  /** the schedule line on the compact card */
  schedule: string
  shape: string
  /** why this group is in front of the member at all */
  why: string
  joined: number
  open: number
  /** anything else true of the people already in it */
  roomNote?: string
  /** the primary action, when it is not "Request a seat" */
  action?: string
  /** true when the member is already in this group and it is offering a next
      cycle rather than a new room */
  continues?: boolean
}

export const MATCHES: Match[] = [
  {
    id: 'g1',
    title: "Grief that doesn't follow the stages",
    seats: '2 seats left',
    urgent: false,
    status: 'STARTS 12 SEP · 4 SESSIONS / MONTH',
    blurb:
      "For people whose loss doesn't fit the timeline they were promised. Six members, camera optional, Thursdays.",
    therapist: 'Dr. Léo Mercier',
    credential: 'bereavement · 9 yrs of groups',
    colour: 'oklch(0.70 0.085 200)',
    schedule: 'Thu 6:30 pm · 4× / month',
    shape: '6 members · camera optional',
    why: 'you named anticipatory loss in intake, and this group runs the night you’re free. Dr. Osei flagged it as a good next step after your cycle.',
    joined: 4,
    open: 2,
    roomNote: 'all anonymous so far',
  },
  {
    id: 'g2',
    title: 'Coming off a decade of caretaking',
    seats: '1 seat left',
    urgent: true,
    status: 'RUNNING · JOIN AT SESSION 2',
    blurb:
      'A voice-only group — nobody turns a camera on, by agreement. Eight members, Mondays, 8:00 pm.',
    therapist: 'Dr. Nadia Haddad',
    credential: 'carer burnout · 14 yrs',
    colour: 'oklch(0.70 0.085 340)',
    schedule: 'Mon 8:00 pm · 4× / month',
    shape: '8 members · voice-only group',
    why: 'voice-only matches how you’ve attended every session so far.',
    joined: 7,
    open: 1,
  },
  {
    id: 'g3',
    title: 'Health anxiety, second cycle',
    seats: '3 seats left',
    urgent: false,
    status: 'STARTS 19 SEP · 4 SESSIONS / MONTH',
    blurb:
      'The cycle you are in, run again with the same therapist. Three of your seven stay on.',
    therapist: 'Dr. Amara Osei',
    credential: 'your therapist',
    colour: 'oklch(0.60 0.12 42)',
    schedule: 'Tue 7:00 pm · 4× / month',
    shape: '7 members · continues your work',
    why: 'it continues the work you are already doing, on the night you already keep free.',
    joined: 4,
    open: 3,
    action: 'Stay with this group',
    continues: true,
  },
]

export const MATCH_FILTERS = ['Evenings', 'Voice-only ok', '6–8 members'] as const

export const MORE_MATCHES = {
  line: '21 more groups matched, 6 with seats',
  note: 'Sorted by fit, then by how soon they start.',
} as const

export const SHORTLIST_NOTE =
  'Shortlisted from your intake, then checked by a clinician before you see them.'

export const FIND_NOTE =
  'Ranked from your intake answers, then read by a clinician before it reaches you. You can see why each one is here.'

/* --- Starting your own --------------------------------------------------- */

export const OWN_GROUP = {
  eyebrow: 'or start your own',
  title: 'Bring the people. We’ll bring the therapist.',
  blurb:
    "Invite 6–8 people, set the topic and the night. We'll shortlist therapists who take private groups.",
  steps: [
    { id: 'topic', label: 'step 1 · topic', value: 'Adult siblings of addicts' },
    { id: 'size', label: 'step 2 · size', value: '6 of 8 invited' },
    { id: 'night', label: 'step 3 · night', value: 'Wed · 7:30 pm' },
  ],
  terms:
    'Cost is split across members. Nothing is charged until the therapist accepts.',
} as const

export type Hire = {
  id: string
  name: string
  practice: string
  /** where this therapist stands with the invite */
  state: 'invited' | 'open' | 'waitlist'
}

export const HIRE: Hire[] = [
  {
    id: 'h1',
    name: 'Dr. Priya Raghavan',
    practice: 'family systems · takes private groups · Wed free',
    state: 'invited',
  },
  {
    id: 'h2',
    name: 'Dr. Tomás Iglesias',
    practice: 'CBT · addiction-adjacent · Wed free',
    state: 'open',
  },
  {
    id: 'h3',
    name: 'Dr. Hana Kobayashi',
    practice: 'somatic · waitlist 3 weeks',
    state: 'waitlist',
  },
]

/* --- Before you join ----------------------------------------------------- */

export const JOIN_STEP = {
  eyebrow: 'step 2 of 3 · before your first session',
  title: 'How do you want to be in the room?',
  note: 'Your name is set once for this group. How you appear can change before each session, and nobody is told what you changed.',
  privacy:
    'Sessions are never recorded. Live captions are generated on your device and discarded when the session ends.',
} as const

/* One box, not a choice between "a name you choose" and "my real first
   name". Which kind of name it is is the member's business; the platform
   only needs to know what to call them. */
export const NAME_STEP = {
  label: 'your name in the group',
  hint: 'Any name you like, made up or your real first name. Members see only this; your therapist knows who you are.',
  placeholder: 'e.g. Wren, Asha, Ravi',
  suggestions: ['Wren', 'Ash', 'Halo', 'Nim'],
  lockNote:
    'This name stays the same for every session of this group. You can choose a new one when you join another group.',
  locked: 'Locked for this group. You can choose a new name when you join another group.',
} as const

export const PRESENCE_CHOICES = [
  {
    id: 'avatar',
    title: 'Avatar + voice',
    body: 'They hear you, they see your avatar',
    flag: 'recommended for session 1',
  },
  {
    id: 'camera',
    title: 'Camera on',
    body: 'Your face fills the same circle',
    flag: 'camera preview',
  },
  {
    id: 'listen',
    title: 'Listen only',
    body: 'Present, muted, no pressure to speak',
    flag: 'max 2 sessions',
  },
] as const

/* --- The avatar builder -------------------------------------------------- */

export const BUILDER = {
  title: 'Choose a stand-in',
  blurb:
    "It doesn't have to look like you. Most people pick something that feels like how they'd want to be met.",
  pickNote: 'Twelve portraits, a woman and a man at every age. Change it before any session.',
  carried: 'Your avatar is yours across every group you join.',
  saved: 'Saved to your profile, under your handle only.',
  motion: [
    {
      id: 'move',
      title: 'Moves with your voice',
      body: 'Mouth and shoulders follow speech volume',
      on: true,
    },
    {
      id: 'still',
      title: 'Stays still',
      body: "Only the ring shows you're speaking",
      on: false,
    },
  ],
} as const

/* --- The live session ---------------------------------------------------- */

export const SESSION = {
  elapsed: '34:12',
  /** who has the floor. `seat` points into SEATS so the panel that shows them
      and the circle that seats them can never disagree about the camera. */
  speaker: { seat: 'marlow', spoken: '4 min 20 s this session' },
  queue: ['Pip', 'you'],
  room: '4 cameras · 4 avatars',
  avatarNote: 'Camera off shows your avatar, never a blank tile.',
  circleNote: 'Whoever speaks moves to the centre. Nobody is on a grid.',
  chatNote: 'chat is visible to the group',
  quickReplies: ['Same here', 'Need a minute', '✋ Hand up'],
  typing: 'Sable is typing…',
} as const

export type ChatLine = {
  id: string
  who: string
  /** the seat this line belongs to, for the avatar beside it */
  seat: string
  body: string
  from: 'member' | 'therapist' | 'you'
}

export const CHAT: ChatLine[] = [
  {
    id: 'c1',
    who: 'Juniper',
    seat: 'juniper',
    body: 'the tight-chest thing — same. i thought it was just me',
    from: 'member',
  },
  {
    id: 'c2',
    who: 'Dr. Osei · therapist',
    seat: 'osei',
    body: 'Hold that. Marlow, keep going — I want Juniper to hear the end of it.',
    from: 'therapist',
  },
  {
    id: 'c3',
    who: 'You · Wren',
    seat: 'wren',
    body: "mine starts in the jaw. never noticed until last week's task",
    from: 'you',
  },
  { id: 'c4', who: 'Pip', seat: 'pip', body: '✋ can i go after Marlow', from: 'member' },
]

/* --- The circle, as a set of states -------------------------------------- */

export const CIRCLE_STATES = [
  {
    id: 'quiet',
    label: 'state 01 · silence',
    speaking: -1,
    tone: 'dim' as const,
    body: "Everyone in their seat, therapist ringed in terracotta. Silence isn't an error state — it's labelled QUIET.",
  },
  {
    id: 'member',
    label: 'state 02 · a member speaks',
    speaking: 3,
    tone: 'green' as const,
    body: 'Marlow travels to the centre over 650 ms and doubles in size. His seat stays as a soft hollow — he hasn’t left the group.',
  },
  {
    id: 'therapist',
    label: 'state 03 · therapist speaks',
    speaking: 0,
    tone: 'terra' as const,
    body: 'Dr. Osei takes the same centre — no bigger, no throne. Only the ring colour tells you who’s leading.',
  },
]

export const CIRCLE_RULES = [
  {
    id: 'avatars',
    label: 'avatars',
    body: 'Every member is a flat character at the same size. Camera on or off, the seat is the same shape.',
  },
  {
    id: 'overlap',
    label: 'overlap rule',
    body: 'The centre avatar never covers a seat, so you can always count the room.',
  },
  {
    id: 'interrupt',
    label: 'interruptions',
    body: 'Two people at once: the centre holds the first, the second gets a soft glow in place. No fighting for the middle.',
  },
  {
    id: 'camera',
    label: 'camera on',
    body: 'Video fills the same circle. Avatar and face are interchangeable — the layout never changes shape.',
  },
]
