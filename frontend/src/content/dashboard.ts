/* ============================================================================
   Member dashboard copy and illustrative data.

   Voice is the same as site.ts — plain verbs, sentence case, active. The
   dashboard adds one rule of its own: it never grades anyone. There is no
   wellbeing score, no percentage, no streak count, because the architecture
   forbids assigning scores (§7.4) and forbids addictive streaks and
   engagement loops outright. Numbers here only ever count *things that
   exist* — replies waiting, days recorded, minutes long.
   ========================================================================= */

export const MEMBER = {
  handle: 'QuietRiver-4821',
  plan: 'Anonymous Community',
  planId: 'free',
} as const

/* --- The seam ------------------------------------------------------------
   Fourteen days. Gold where a check-in exists, dark stone where none does.
   Deliberately NOT a streak: nothing resets, no count is shown, and a gap is
   just unfilled stone rather than a failure. Kintsugi logic — the gold is the
   record of mending and the gaps are part of the object.
   ------------------------------------------------------------------------ */
export const SEAM_DAYS: boolean[] = [
  true, true, false, true, true, true, false,
  false, true, true, true, true, false, true,
]

/* --- Daily check-in ------------------------------------------------------ */

export const MOODS = [
  { v: 1, label: 'Very low' },
  { v: 2, label: 'Low' },
  { v: 3, label: 'Level' },
  { v: 4, label: 'Good' },
  { v: 5, label: 'Very good' },
] as const

/** Plain feeling words, never clinical labels. */
export const FEELING_TAGS = [
  'Anxious', 'Tired', 'Numb', 'Restless',
  'Angry', 'Lonely', 'Hopeful', 'Steady',
]

/* --- The mood scale ------------------------------------------------------
   Seven steps, plain words, no numbers. The architecture forbids scoring
   people, so this records a word rather than grading a day.
   ------------------------------------------------------------------------ */

export const MOOD_SCALE = [
  'Heavy', 'Low', 'Flat', 'Level', 'Steady', 'Light', 'Good',
] as const

/* --- The stress scale ----------------------------------------------------
   Eleven steps, because unlike mood this is a load the member reports about
   their day rather than a judgement of the member. A number is legible here
   for the same reason hours slept is: it counts something they lived, and it
   is theirs to set. The word underneath is what they actually read.
   ------------------------------------------------------------------------ */

export const STRESS_SCALE = [
  'Calm', 'Calm', 'Easy', 'Easy', 'Manageable', 'Manageable',
  'Tight', 'Tight', 'Loud', 'Overloaded', 'Overloaded',
] as const

export const STRESS_MAX = 10

/** Fourteen days of mood (0-6 on the scale above) and hours slept. */
export const TRENDS: { mood: number; sleep: number }[] = [
  { mood: 2, sleep: 5.5 }, { mood: 1, sleep: 4.8 }, { mood: 3, sleep: 6.2 },
  { mood: 3, sleep: 6.8 }, { mood: 2, sleep: 5.9 }, { mood: 4, sleep: 7.4 },
  { mood: 4, sleep: 7.1 }, { mood: 3, sleep: 6.0 }, { mood: 5, sleep: 7.8 },
  { mood: 4, sleep: 6.6 }, { mood: 4, sleep: 7.2 }, { mood: 5, sleep: 7.5 },
  { mood: 3, sleep: 5.7 }, { mood: 4, sleep: 6.7 },
]

/* --- The current month ---------------------------------------------------
   The charts plot the calendar month the member is actually in, so the axis
   means something specific rather than a rolling window. Days after today
   hold null: the line stops where the record stops, which is also how a gap
   stays a gap rather than being interpolated over.
   ------------------------------------------------------------------------ */

export type DayEntry = {
  /** 1-31 */
  day: number
  /** index into MOOD_SCALE, or null if nothing was recorded */
  mood: number | null
  /** hours slept, or null */
  sleep: number | null
}

export function monthShape(now: Date = new Date()) {
  return {
    days: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
    today: now.getDate(),
    name: now.toLocaleDateString('en-GB', { month: 'long' }),
    full: now.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
    /** `SUN 24 AUG` — the mono caps form used on the sculpture panel. */
    short: now
      .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
      .replace(/,/g, '')
      .toUpperCase(),
  }
}

/* Deterministic rather than Math.random: the illustrative history has to be
   stable across renders, or the chart reshuffles every time React repaints. */
function noise(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/** Illustrative history for the days already gone. Today and after are null
    until the member records something. */
export function seedMonth(days: number, today: number): DayEntry[] {
  return Array.from({ length: days }, (_, i) => {
    const day = i + 1
    if (day >= today) return { day, mood: null, sleep: null }
    const drift = Math.sin(day / 4.5) * 1.1
    return {
      day,
      mood: Math.max(0, Math.min(6, Math.round(3.4 + drift + noise(day) * 1.6 - 0.8))),
      sleep: +(6.4 + drift * 0.55 + (noise(day * 7) - 0.5) * 1.7).toFixed(1),
    }
  })
}

/** Hours slept, as a step the member can nudge. Ten minutes: fine enough that
    the number is honest, coarse enough that setting it is two or three taps. */
export const SLEEP_STEP = 1 / 6
export const SLEEP_MIN = 0
export const SLEEP_MAX = 12

/** `6h 40m`. Sleep is always shown as time, never as a decimal. */
export function formatSleep(hours: number) {
  const total = Math.round(hours * 60)
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`
}

/* --- Trends over a range -------------------------------------------------
   The chart reads three metrics over a week, a month or a year, and each of
   the three keeps its own scale — normalising them onto one axis would imply
   a composite wellbeing figure, which is the score §7.4 forbids. So `all`
   draws three lines, each against its own range, and says so in the caption.

   Everything before today is illustrative and deterministic; the final point
   is whatever the member has set on this screen, so the curve visibly moves
   when they record.
   ------------------------------------------------------------------------ */

export type Metric = 'mood' | 'sleep' | 'stress'
export type Range = 'week' | 'month' | 'year'

/* Low and high bound per metric — the y-axis.
 *
 * Each of these has to cover everything its own control can produce, or the line
 * leaves the box and is clipped by the card. Both of the first two used to fail that:
 *
 *   mood   was [0, 6], the index into MOOD_SCALE. But `mood_checkins.mood_score` is
 *          1-10 and the API rejects anything below 1, so the leftmost step — "Heavy",
 *          the worst day somebody can report — was sent as 0 and came back 400. The
 *          member having the heaviest day was the one who could not record it. The
 *          seven steps are now 1-7, which the column and the API both accept.
 *
 *   sleep  was [4, 10] while SLEEP_MIN/SLEEP_MAX allow 0-12, so a short night or a
 *          long one ran off the top or bottom of the chart.
 *
 * `projectGapped` also clamps, so a value from somewhere else — an older row, another
 * client — is pinned to the edge rather than drawn outside the card.
 */
export const SCALE: Record<Metric, [number, number]> = {
  mood: [1, 7],
  sleep: [0, 12],
  stress: [0, 10],
}

/** Axis captions, top to bottom, at the values they sit on. */
export const TICKS: Record<Metric, number[]> = {
  mood: [7, 5, 3, 1],
  sleep: [12, 9, 6, 3, 0],
  stress: [10, 8, 6, 4, 2],
}

/* `RANGE_LENGTH` was here — { week: 7, month: 30, year: 12 }. Nothing imported it, and
   two of its three values were wrong once the ranges became calendar periods: a month
   is 28 to 31 days, and the year view counts days rather than months. `rangeWindow`
   derives all of it from the date. Removed rather than corrected, because a constant
   nobody reads is the one somebody reaches for next. */

/* `trend()` was here. It generated a sine wave with seeded noise and only the final
   point was real, so a new account displayed a month of mood it had never lived.
   Removed rather than left unused: a generator that fabricates somebody's clinical
   history is not a helper to keep around for later. The chart now reads
   /api/mood/checkins and leaves gaps where there is no check-in. */


const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const atMidnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/**
 * The calendar period a range covers: where it starts, and how many days wide it is.
 *
 * All three are whole calendar periods, drawn at full width — the week Monday to
 * Sunday, the month the 1st to the 28th, 29th, 30th or 31st depending on the month and
 * the year, the year January to December. The axis is therefore the shape of the period
 * itself and does not move from day to day.
 *
 * Only the days up to today carry a reading. The rest of the axis is empty, which is
 * the honest picture: the month exists, and the part of it nobody has lived yet is
 * blank rather than absent. The line stops at today.
 *
 * This is what the day-of-month axis always implied, and what two earlier attempts got
 * wrong in opposite directions — first a fixed axis with a rolling window under it,
 * which labelled the last reading with a date six days in the future, then a window
 * that ended at today and shrank the month to fit it.
 */
export function rangeWindow(range: Range, now: Date = new Date()): { start: Date; length: number } {
  if (range === 'week') {
    const start = atMidnight(now)
    // Monday-first: getDay() is 0 on Sunday, which is the last day, not the first.
    start.setDate(start.getDate() - ((now.getDay() + 6) % 7))
    return { start, length: 7 }
  }

  if (range === 'month') {
    // Day 0 of the next month is the last day of this one — 28, 29, 30 or 31, with
    // February's leap year handled by the calendar rather than by us.
    const length = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), length }
  }

  const start = new Date(now.getFullYear(), 0, 1)
  const nextYear = new Date(now.getFullYear() + 1, 0, 1)
  const length = Math.round((nextYear.getTime() - start.getTime()) / 86_400_000)
  return { start, length }
}

/** How far through its period today is, as a series index. -1 before it, length-1 after. */
export function todayIndex(range: Range, now: Date = new Date()): number {
  const { start, length } = rangeWindow(range, now)
  const i = Math.round((atMidnight(now).getTime() - start.getTime()) / 86_400_000)
  return Math.max(-1, Math.min(length - 1, i))
}

/**
 * Axis labels along the bottom, spread across the whole period.
 *
 * Laid out with `justify-between`, so label i sits at i/(count-1) of the plot width and
 * names the day at that same fraction of the period. The last label is the last day of
 * the period — Sunday, the 31st, December — not today, because the axis is the month
 * and the month does not end when today does.
 */
export function rangeLabels(range: Range, now: Date = new Date()): string[] {
  const { start, length } = rangeWindow(range, now)

  /** The day a label sits over, for `count` labels spread across the period. */
  const dayAt = (i: number, count: number) => {
    const idx = count === 1 ? length - 1 : Math.round((i * (length - 1)) / (count - 1))
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + idx)
  }

  if (range === 'week') {
    return Array.from({ length: 7 }, (_, i) => WEEKDAY[dayAt(i, 7).getDay()]!)
  }

  if (range === 'year') {
    return Array.from({ length: 6 }, (_, i) => MONTH[dayAt(i, 6).getMonth()]!)
  }

  // Seven labels across the month, so the last is always its final day.
  return Array.from({ length: 7 }, (_, i) => String(dayAt(i, 7).getDate()))
}

/* --- Practice assigned or chosen ----------------------------------------- */

export type Task = {
  id: string
  title: string
  /** who put it there — never presented as an instruction from the platform */
  source: 'Suggested' | 'Dr. Rao' | 'Yours'
  done: boolean
}

export const TASKS: Task[] = [
  { id: 'k1', title: 'Slow breathing, four counts', source: 'Suggested', done: true },
  { id: 'k2', title: 'Write one line about Sunday', source: 'Dr. Rao', done: true },
  { id: 'k3', title: 'Walk before the 3pm call', source: 'Yours', done: false },
]

/* --- What came back while you were away ---------------------------------- */

export const WAITING = {
  visible: 2,
  held: 5,
  filtered: 3,
} as const

/* --- Guided activities (on every account) -------------------------------- */

export type Activity = {
  id: string
  name: string
  kind: string
  minutes: number
}

export const ACTIVITIES: Activity[] = [
  { id: 'ground', name: 'Five things you can see', kind: 'Grounding', minutes: 4 },
  { id: 'breath', name: 'Slow breathing, four counts', kind: 'Breathing', minutes: 6 },
  { id: 'unhook', name: 'Naming the thought', kind: 'Reflection', minutes: 8 },
]

/* --- Your posts ----------------------------------------------------------
   Free plan: five-day expiry, two visible replies, the rest held.
   ------------------------------------------------------------------------ */

export type MyPost = {
  id: string
  /** what was written: a burden, a journal entry, or a short story */
  kind: 'post' | 'journal' | 'story'
  category: string
  body: string
  ago: string
  expiresIn: string
  /** peer replies the member can currently see */
  replies: number
  /** peer replies accepted and stored, but held by the free plan's limit */
  held: number
  /** replies removed by the safety filter, which nobody sees */
  filtered?: number
  /** §5.1 gives every post one AI supportive response */
  ai?: boolean
}

export const MY_POSTS: MyPost[] = [
  {
    id: 'p1',
    kind: 'post',
    category: 'Family',
    body: 'I moved cities for a job my parents still describe to relatives as a phase.',
    ago: '2 hours ago',
    expiresIn: '4d 18h',
    replies: 2,
    held: 5,
    filtered: 1,
    ai: true,
  },
  {
    id: 'p2',
    kind: 'post',
    category: 'Friendship and loneliness',
    body: 'Three group chats and nobody I could call at 2am.',
    ago: '2 days ago',
    expiresIn: '2d 4h',
    replies: 2,
    held: 0,
    ai: true,
  },
  {
    id: 'p3',
    kind: 'journal',
    category: 'Work and career',
    body: 'Kept a record of the week I stopped answering the group chat, mostly to see whether it was as long as it felt.',
    ago: '4 days ago',
    expiresIn: '20h',
    replies: 2,
    held: 3,
    ai: true,
  },
]

/* --- Therapists ----------------------------------------------------------
   Deliberately open on every plan, including the free one. Browsing who is
   available is how someone decides whether care is worth paying for; putting
   it behind the paywall would be selling a locked box.
   ------------------------------------------------------------------------ */

export type Therapist = {
  id: string
  handle: string
  category: string
  reg: string
  languages: string[]
  modes: string[]
  distance: string | null
  next: string
}

export const THERAPISTS: Therapist[] = [
  {
    id: 't1',
    handle: 'Dr. A. Nair',
    category: 'Clinical psychologist',
    reg: 'RCI A-3391',
    languages: ['English', 'Malayalam'],
    modes: ['Online', 'In person'],
    distance: '4 km',
    next: 'Thu, 7:30 pm',
  },
  {
    id: 't2',
    handle: 'Dr. S. Bhatt',
    category: 'Psychiatrist',
    reg: 'NMC 77120',
    languages: ['English', 'Hindi'],
    modes: ['Online'],
    distance: null,
    next: 'Fri, 9:00 am',
  },
  {
    id: 't3',
    handle: 'M. Rao',
    category: 'Counsellor',
    reg: 'RCI C-8842',
    languages: ['English', 'Kannada'],
    modes: ['Online', 'In person'],
    distance: '11 km',
    next: 'Today, 8:15 pm',
  },
]

/* --- Locked features -----------------------------------------------------
   Visible and readable, never blurred — someone deciding whether to pay has
   to be able to see what they would get. Rendered as unfilled stone rather
   than padlocked: gold means yours, plain stone means not yet.
   ------------------------------------------------------------------------ */

export type Locked = {
  id: string
  title: string
  body: string
  plan: string
  planId: string
  price: string
}

export const LOCKED: Locked[] = [
  {
    id: 'replies',
    title: 'The replies being held for you',
    body: 'Five people answered your last post. The free plan shows you two of them.',
    plan: 'Interaction Plus',
    planId: 'plus',
    price: '₹99 / month',
  },
  {
    id: 'circles',
    title: 'Support circles',
    body: 'Keep a handful of handles you trust, and ask them directly without learning who they are.',
    plan: 'Interaction Plus',
    planId: 'plus',
    price: '₹99 / month',
  },
  {
    id: 'group',
    title: 'Your group space',
    body: 'Six to eight people and one verified therapist, meeting weekly in your region.',
    plan: 'Guided Group Care',
    planId: 'group',
    price: '₹799 / month',
  },
  {
    id: 'sessions',
    title: 'Sessions and therapist tasks',
    body: 'One-to-one appointments, the privacy mode you pick before each one, and the practice they set between them.',
    plan: 'Individual Care',
    planId: 'individual',
    price: 'Set by provider',
  },
]

/* --- Group rooms ---------------------------------------------------------
   Twelve people and one facilitator. Shown on every plan for the same reason
   therapists are: you cannot decide whether a room is worth joining from a
   price list.
   ------------------------------------------------------------------------ */

export type Room = {
  id: string
  /** where the member stands with this room, which is also the card's tone */
  state: 'yours' | 'open' | 'waitlist'
  meta: string
  title: string
  detail: string
  action: string
}

export const ROOMS: Room[] = [
  {
    id: 'r1',
    state: 'yours',
    meta: 'Yours · Wednesdays',
    title: 'Leaving home, staying close',
    detail: 'Next meets in 2 days · 9 of 12 attending',
    action: 'Open room',
  },
  {
    id: 'r2',
    state: 'open',
    meta: 'Open · 3 seats',
    title: 'Sleep and the 3am mind',
    detail: 'Tuesdays, 45 minutes · facilitated',
    action: 'Request a seat',
  },
  {
    id: 'r3',
    state: 'waitlist',
    meta: 'Waitlist',
    title: 'Caring for a parent',
    detail: 'Opens next month · 4 ahead of you',
    action: 'Keep my place',
  },
]

/* --- Care ----------------------------------------------------------------
   What the clinician can see is stated on the screen itself rather than in a
   settings page, because the answer is the whole reason someone trusts it.
   ------------------------------------------------------------------------ */

export const CLINICIAN = {
  name: 'Dr. Meera Rao',
  next: 'Next session Thursday, 6:30pm · 40 minutes',
  note: 'Dr. Rao reads your weekly summary on Mondays.',
} as const

export const SHARED_WEEKLY: { label: string; value: string }[] = [
  { label: 'Mood average', value: 'Level' },
  { label: 'Sleep average', value: '6h 52m' },
  { label: 'Stress average', value: '6.1 / 10' },
  { label: 'Practice done', value: '17 of 21' },
]

/* --- Always available, never sold ---------------------------------------- */

export const CONTROLS = [
  { id: 'privacy', title: 'Privacy controls', body: 'What is stored, for how long, and who may ever reach it.' },
  { id: 'consent', title: 'Consent record', body: 'Every grant you have made, per record, withdrawable here.' },
  { id: 'safety', title: 'Safety plan', body: 'Your own words, ready before you need them.' },
  { id: 'data', title: 'Export or delete', body: 'Take everything with you, or remove it for good.' },
]
