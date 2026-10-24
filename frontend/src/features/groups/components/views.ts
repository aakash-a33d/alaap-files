/* The screens the Groups tab holds.

   There is no tab strip. Every one of these is reached from the sentence on
   the week view that raises it — "Open task space", "See full report",
   "Browse all 24", "How the circle works" — because those links already exist
   on the cards and a row of pills above them was the same navigation twice,
   with the pills winning and the links going unread.

   Setting up how you appear is not in this list at all. It is a thing you do
   once, from your profile or on the way into your first session, so it lives
   in a dialog rather than a screen you could wander onto. */

export type GroupView = 'week' | 'tasks' | 'reports' | 'find' | 'circle'

/** What the back link says on each screen. The week view has none — it is the
    tab. */
export const BACK_TO_WEEK: Record<Exclude<GroupView, 'week'>, string> = {
  tasks: 'Your week',
  reports: 'Your week',
  find: 'Your week',
  circle: 'Your week',
}
