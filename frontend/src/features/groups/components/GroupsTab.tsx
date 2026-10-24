import { useEffect, useState } from 'react'
import { GROUP } from '../../../content/groups'
import { DISPLAY } from '../../../pages/dashboard/tokens'
import { CircleView } from './CircleView'
import { FindGroupView } from './FindGroupView'
import { ReportsView } from './ReportsView'
import { SessionView } from './SessionView'
import { TaskSpaceView } from './TaskSpaceView'
import { WeekView } from './WeekView'
import { BackLink } from './parts'
import { BACK_TO_WEEK, type GroupView } from './views'

/* ============================================================================
   Groups — the member's side of group care.

   The week view is the tab. Everything else is opened by the sentence on a
   card that raises it — "Open task space", "See full report", "Browse all
   24", "How the circle works" — and closed by one back link at the top. A tab
   strip above those cards was the same navigation written twice, and the
   version in the pills won every time, so the links on the cards were dead
   text and the cards lost the one thing that made them cards.

   The live session is not a view at all. It takes the window, because for
   ninety minutes there is nothing else to be doing.

   The tab owns its own 1240px measure and its own palette, scoped to
   `.gr-room` in index.css.
   ========================================================================= */

export default function GroupsTab({
  onOpenSetup,
  setupComplete,
  inSession,
  onSession,
}: {
  /** the two setup screens live in a dialog the dashboard owns */
  onOpenSetup: (step: 'avatar' | 'presence', reason?: 'first-join') => void
  setupComplete: boolean
  /** owned above so that finishing setup can carry somebody the rest of the
      way into the room they were trying to reach when we stopped them */
  inSession: boolean
  onSession: (open: boolean) => void
}) {
  const [view, setView] = useState<GroupView>('week')

  /* Nothing behind the session should scroll while it has the window. */
  useEffect(() => {
    if (!inSession) return
    const prior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prior
    }
  }, [inSession])

  /* The gate. Somebody who has never said how they want to be in a room does
     not get dropped into one — they get asked first, once, and are then taken
     the rest of the way. */
  const enterSession = () => {
    if (!setupComplete) {
      onOpenSetup('avatar', 'first-join')
      return
    }
    onSession(true)
  }

  if (inSession) {
    return (
      <SessionView
        onLeave={() => onSession(false)}
        onOpenTasks={() => {
          onSession(false)
          setView('tasks')
        }}
      />
    )
  }

  return (
    <div className="gr-room gr-shell">
      <header>
        <h1 className={`${DISPLAY} text-[clamp(1.35rem,4vw,1.75rem)] leading-none`}>Groups</h1>
        {/* One group, named, rather than a count of rooms — this member is in
            a closed cycle and the tab should say which one. */}
        <p className="mt-2 text-[0.78rem] text-[var(--app-faint)]">
          {GROUP.title} · {GROUP.members} members · led by {GROUP.therapist}
        </p>
      </header>

      {view !== 'week' && (
        <div className="mt-4">
          <BackLink label={BACK_TO_WEEK[view]} onClick={() => setView('week')} />
        </div>
      )}

      <div className="mt-4">
        {view === 'week' && (
          <WeekView
            go={setView}
            onEnterSession={enterSession}
            onChangePresence={() => onOpenSetup('presence')}
          />
        )}
        {view === 'tasks' && <TaskSpaceView go={setView} />}
        {view === 'reports' && <ReportsView />}
        {view === 'find' && <FindGroupView />}
        {view === 'circle' && <CircleView />}
      </div>
    </div>
  )
}
