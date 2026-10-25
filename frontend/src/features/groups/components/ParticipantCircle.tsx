import { useId } from 'react'
import { SEATS, type Seat } from '../../../content/groups'
import { MEMBER_LOOKS, portraitOf, type AvatarLook } from '../model/avatar'
import { useMyLook } from '../model/myLook'
import { usePrefersReducedMotion } from '../model/session'
import { AvatarArt } from './Avatar'

/** Who a seat is drawn as: the member's own saved look in their own seat, the
    illustrative look for everyone else, nothing for the therapist. */
export function lookOf(seat: Seat, mine: AvatarLook): AvatarLook | undefined {
  if (seat.role === 'you') return mine
  return seat.face ? MEMBER_LOOKS[seat.face] : undefined
}

/* ============================================================================
   The circle — the group as an object rather than a grid of tiles.

   Eight seats on a ring. Whoever is speaking travels to the middle over 650ms
   and doubles in size; their seat stays behind as a soft hollow, because
   leaving a hole where someone was is what makes a group of seven still look
   like seven while one of them is talking. The centre figure is sized so it
   never covers a seat, so the room stays countable at every moment.

   Silence is a state, not a failure: with nobody speaking the middle says
   QUIET and every seat stays exactly where it was. A video grid has no way to
   show that, which is most of the reason this is not a video grid.

   The geometry is authored once on a 360×360 field and scaled, so a seat is
   the same shape at 248px on the overview card and 384px on the live stage —
   one set of numbers to trust rather than four sets to keep in agreement.
   ========================================================================= */

/* The geometry is authored on a 360-unit field and then expressed as
   percentages of whatever box the circle is given, so one set of numbers
   serves a 244px preview and a 640px stage with nothing to keep in agreement.

   It used to scale a fixed 360px field with a transform, which meant the
   caller had to know the pixel size — and on the live stage, where the circle
   is half the window, that size had to be measured. A ResizeObserver is a
   poor thing to make a picture depend on: it delivers during the rendering
   steps, so anywhere frames are not being produced the circle simply never
   appears. Percentages need no measurement and no frames.

   Type scales with the box instead, off a font-size set on the field: one em
   is what 16px was at 360, so every label below is written in ems of that.

   Seats are placed by their centres rather than their top-left corners. That
   is what lets a seat be resized without moving it: the ring the eight of
   them sit on is fixed at r=140 whatever diameter they are drawn at, so
   making the faces smaller leaves the shape of the group untouched. */

const FIELD = 360
const pct = (n: number) => `${((n / FIELD) * 100).toFixed(3)}%`
/** 16px at a 360 field — the em every label inside is measured in. */
const EM = FIELD / 16

/** The ring the group sits on. Fixed: seat sizes change, this does not. */
const RING = 140
/** The inner guide, at the radius the centre figure is read against. */
const INNER = 106

const SEAT = 46
const CENTRE = 100
/** How far a name hangs past the bottom of the field. The lowest seat ends at
    343, its name sits 6 below that and is one line of about 10 — so 6 units
    clear it. Every unit reserved here is a unit the circle does not get. */
const LABEL_BAND = 6 / FIELD

/** Seat centres, clockwise from the top. Authored by hand: an even angular
    sweep put two seats hard against the card's corners at the sizes actually
    used, so these are nudged onto the ring the eye reads rather than the one
    the arithmetic gives. */
const CENTRES: [number, number][] = [
  [180, 40],
  [279, 81],
  [320, 180],
  [279, 279],
  [180, 320],
  [81, 279],
  [40, 180],
  [81, 81],
]

/** A box of `d` units centred on a point, as CSS percentages. */
function at([cx, cy]: [number, number], d: number) {
  return { left: pct(cx - d / 2), top: pct(cy - d / 2), width: pct(d), height: pct(d) }
}

/** Fully controlled: the circle draws whoever it is told is speaking and keeps
    no opinion of its own. On the live session that value comes from the same
    hook the speaker panel reads, which is what stops the two disagreeing. */
export function ParticipantCircle({
  /** index into SEATS, or -1 for the quiet state */
  speaking = -1,
  /** a number of pixels, or any CSS length — `min(46vw, 62vh)` on the stage */
  size = 360,
  labels = true,
  onDark = false,
  you,
}: {
  speaking?: number
  size?: number | string
  labels?: boolean
  onDark?: boolean
  /** the member's own seat drawn with a look they have not saved yet — the
      builder previewing an avatar in the room it will actually be seen in */
  you?: AvatarLook
}) {
  const reduced = usePrefersReducedMotion()
  const live = speaking
  const dim = onDark ? 'rgb(244 241 234 / 0.5)' : 'var(--app-dim)'

  const box = typeof size === 'number' ? `${size}px` : size
  /* The box has to include the names that hang below it, or whatever sits
     underneath — the caption pill on the stage, the paragraph on the states
     screen — ends up touching them. */
  const height = labels ? `calc(${box} * ${(1 + LABEL_BAND).toFixed(4)})` : box

  return (
    <div className="relative flex-none" style={{ width: box, height }}>
      <div
        aria-hidden="true"
        className="absolute left-0 top-0 w-full"
        style={{ aspectRatio: '1', fontSize: `calc(${box} / ${EM})` }}
      >
        {/* The two guide rings. Drawn in SVG rather than as a dashed border,
            because a CSS border's dash length is derived from its width and
            comes out as long strokes at any width thick enough to see. Here
            the dash is set in field units, so it stays a fine broken line at
            every size the circle is drawn at. */}
        <svg
          viewBox={`0 0 ${FIELD} ${FIELD}`}
          className="absolute inset-0 h-full w-full"
          fill="none"
        >
          <circle
            cx={FIELD / 2}
            cy={FIELD / 2}
            r={RING}
            stroke="var(--gr-terra-ring)"
            strokeWidth="0.9"
            strokeDasharray="2 3.5"
            strokeLinecap="round"
          />
          <circle
            cx={FIELD / 2}
            cy={FIELD / 2}
            r={INNER}
            stroke="oklch(0.6 0.12 42 / 0.14)"
            strokeWidth="0.9"
            strokeDasharray="2 3.5"
            strokeLinecap="round"
          />
        </svg>

        {/* a hollow under every seat, so the ring is countable even while
            somebody is out of it and speaking in the middle */}
        {CENTRES.map((c) => (
          <div
            key={`hollow-${c[0]}-${c[1]}`}
            className="absolute rounded-full"
            style={{
              ...at(c, SEAT),
              background: onDark ? 'rgb(244 241 234 / 0.07)' : 'var(--gr-hollow)',
            }}
          />
        ))}

        {SEATS.map((seat, i) => (
          <SeatFigure
            key={seat.id}
            seat={seat}
            centre={CENTRES[i]}
            on={i === live}
            labels={labels}
            onDark={onDark}
            still={reduced}
            you={you}
          />
        ))}

        {live < 0 && (
          <div
            className="absolute text-center font-[family-name:var(--font-mono)] uppercase tracking-[0.1em]"
            style={{
              left: pct(110),
              top: pct(158),
              width: pct(140),
              fontSize: '0.625em',
              color: dim,
            }}
          >
            quiet
          </div>
        )}
      </div>

      {/* The circle is a picture to a mouse and a list to a screen reader —
          who is here and who is talking, which is all it ever says. */}
      <p className="sr-only">
        In the circle:{' '}
        {SEATS.map((s) => `${s.name}${s.role === 'therapist' ? ' (therapist)' : ''}`).join(', ')}.{' '}
        {live < 0 ? 'Nobody is speaking.' : `${SEATS[live].name} is speaking.`}
      </p>
    </div>
  )
}

function SeatFigure({
  seat,
  centre,
  on,
  labels,
  onDark,
  still,
  you,
}: {
  seat: Seat
  centre: [number, number]
  on: boolean
  labels: boolean
  onDark: boolean
  still: boolean
  you?: AvatarLook
}) {
  const mine = useMyLook()
  const look = lookOf(seat, you ?? mine)
  /* Travelling to the middle is a move between two centres, which is why the
     seats are placed by centre: the figure grows about its own middle rather
     than pulling towards its top-left as it goes. */
  const frame = on ? at([FIELD / 2, FIELD / 2], CENTRE) : at(centre, SEAT)
  const therapist = seat.role === 'therapist'
  const video = seat.camera && seat.room

  const role = therapist
    ? 'therapist'
    : seat.role === 'you'
      ? 'you'
      : on
        ? video
          ? 'speaking · cam'
          : 'speaking'
        : ''

  /* The centre gets a green halo and a real drop; the therapist keeps a thin
     terracotta ring wherever she is sitting, so who is leading is legible
     without anyone having to be bigger than the rest of the room. */
  const shadow = on
    ? '0 0 0 0.31em var(--gr-green-wash), 0 0.62em 1.9em oklch(0.3 0.02 55 / 0.18)'
    : therapist
      ? '0 0 0 0.125em var(--gr-terra-ring)'
      : '0 0.06em 0.19em oklch(0.3 0.02 55 / 0.1)'

  return (
    <div
      className="absolute"
      style={{
        ...frame,
        zIndex: on ? 5 : 2,
        transition: still
          ? undefined
          : 'left .65s cubic-bezier(.34,.01,.2,1), top .65s cubic-bezier(.34,.01,.2,1), width .65s cubic-bezier(.34,.01,.2,1), height .65s cubic-bezier(.34,.01,.2,1)',
      }}
    >
      <div
        className="relative h-full w-full overflow-hidden rounded-full transition-shadow duration-500"
        style={{ background: look ? portraitOf(look).seat : seat.colour, boxShadow: shadow }}
      >
        <SeatMedia seat={seat} initialSize={on ? '1.9em' : '1.02em'} you={you} />
        <span
          className="absolute inset-0 rounded-full"
          style={{
            boxShadow: `inset 0 0 0 ${on ? '0.125em' : '0.0625em'} ${
              on ? 'rgb(255 255 255 / 0.55)' : 'rgb(26 24 20 / 0.1)'
            }`,
          }}
        />
      </div>

      {video && on && (
        <span
          className="absolute bottom-[2%] right-[2%] grid place-items-center rounded-full bg-[var(--gr-paper)] shadow-[0_1px_4px_rgb(26_24_20/0.25)]"
          style={{ width: '1.375em', height: '1.375em' }}
        >
          <span
            className="rounded-[0.125em] bg-[var(--gr-terra-ink)]"
            style={{ width: '0.5em', height: '0.5em' }}
          />
        </span>
      )}

      {labels && (
        <div
          className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-center"
          style={{ top: 'calc(100% + 0.375em)' }}
        >
          {/* Names are set small on purpose. They are there to be checked —
              who is that, in the seat at four o'clock — not read, and at any
              larger size they compete with the faces they label. The speaker
              keeps a step up because they are the one being looked at. Sizes
              are ems of the field, so they hold at every circle size. */}
          <div
            className="font-medium"
            style={{
              fontSize: on ? '0.68em' : '0.5em',
              color: onDark ? '#f4f1ea' : 'var(--app-ink)',
              opacity: on ? 1 : onDark ? 0.78 : 0.66,
            }}
          >
            {seat.name}
          </div>
          {role && (
            <div
              className="mt-px font-[family-name:var(--font-mono)] uppercase tracking-[0.1em]"
              style={{
                fontSize: '0.42em',
                color: therapist
                  ? 'var(--gr-terra-ink)'
                  : on
                    ? 'var(--gr-green)'
                    : onDark
                      ? 'rgb(244 241 234 / 0.5)'
                      : 'var(--app-dim)',
              }}
            >
              {role}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** What fills a seat: a camera if one is on, the member's portrait if
    not, and the therapist's initial on the group's own stripe. Exported so the
    live session's speaker panel and its roster strip fill their circles the
    same way the circle does — one rule, three places. */
export function SeatMedia({
  seat,
  initialSize = '1.19em',
  you,
}: {
  seat: Seat
  /** any CSS font-size — ems inside the circle, px in the flat strips */
  initialSize?: number | string
  you?: AvatarLook
}) {
  const mine = useMyLook()
  const look = lookOf(seat, you ?? mine)
  if (seat.camera && seat.room) return <VideoSeat room={seat.room} />
  if (look) return <AvatarArt look={look} />
  /* No drawn character for the therapist — an initial on the group's own
     stripe, so she is plainly a person in the room and plainly not one of the
     seven. */
  return (
    <span
      className="flex h-full w-full items-center justify-center font-semibold text-white/95"
      style={{
        fontSize: initialSize,
        backgroundImage:
          'repeating-linear-gradient(-45deg, rgb(255 255 255 / 0.16) 0 4px, transparent 4px 8px)',
      }}
    >
      {seat.initial}
    </span>
  )
}

/** A camera-on seat. Not a video element — this is the shape a real stream
    will be poured into, drawn so the layout can be judged before there is one:
    a lit wall behind, a head and shoulders in front, and the faint scanline
    the eye reads as a feed.

    Drawn in SVG on the same 100-unit field as the flat characters, because
    this seat appears at 34px in the roster strip and 112px in the middle of
    the room. Built out of divs it carried CSS blurs in fixed pixels, so at
    34px a 3px blur ate the whole figure and three of the eight seats were
    smudges. In user units the softness scales with the seat and a camera
    reads as a person at every size a seat is ever drawn. */
function VideoSeat({ room }: { room: NonNullable<Seat['room']> }) {
  const id = useId().replace(/:/g, '')
  return (
    /* `slice` rather than the default `meet`: the speaker panel is a 199×104
       letterbox and a fitted drawing would sit in the middle of it with bare
       card either side. It crops the way a camera does. And no absolute
       positioning — as an absolute child it needed every caller to be a
       positioned ancestor, and the three roster seats that were not stretched
       their feed to the width of the window. */
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      className="block h-full w-full"
    >
      <defs>
        <linearGradient id={`${id}-wall`} x1="0" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stopColor={room.a} />
          <stop offset="100%" stopColor={room.b} />
        </linearGradient>
        <radialGradient id={`${id}-vig`} cx="44%" cy="12%" r="86%">
          <stop offset="34%" stopColor="rgb(30 26 20)" stopOpacity="0" />
          <stop offset="100%" stopColor="rgb(30 26 20)" stopOpacity="0.3" />
        </radialGradient>
        <filter id={`${id}-soft`} x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
        <filter id={`${id}-haze`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.4" />
        </filter>
      </defs>

      <rect x="0" y="0" width="100" height="100" fill={`url(#${id}-wall)`} />

      {/* the window behind them, and the lamp it throws */}
      <g filter={`url(#${id}-haze)`}>
        <path d="M14 0 L38 0 L30 54 L6 54 Z" fill="oklch(0.98 0.02 92 / 0.22)" />
        <circle cx="67" cy="39" r="23" fill="oklch(0.96 0.03 84 / 0.3)" />
      </g>

      <g filter={`url(#${id}-soft)`}>
        {/* shoulders first, then the head over them */}
        <path d="M6 100 C10 76 28 66 50 66 C72 66 90 76 94 100 Z" fill={room.top} />
        <ellipse cx="50" cy="40" rx="16" ry="19" fill={room.skin} />
        <path
          d="M34 38 C34 22 41 15 50 15 C59 15 66 22 66 38 C66 30 59 26 50 26 C41 26 34 30 34 38 Z"
          fill={room.hair}
        />
      </g>

      <rect x="0" y="0" width="100" height="100" fill={`url(#${id}-vig)`} />
      <g fill="rgb(255 255 255 / 0.05)">
        {Array.from({ length: 34 }, (_, i) => (
          <rect key={i} x="0" y={i * 3} width="100" height="1" />
        ))}
      </g>
    </svg>
  )
}
