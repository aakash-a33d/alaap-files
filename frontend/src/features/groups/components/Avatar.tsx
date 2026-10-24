import { partsOf, resolveFace, type Face, type FaceKey } from '../model/avatar'

/* ============================================================================
   One flat character, drawn at whatever size it is given.

   The whole set is a single 100×100 viewBox with the same parts in the same
   order, so the drawing scales from a 24px chat gutter to a 196px preview
   without a second asset and without going soft. See model/avatar.ts for why
   the set is built by swapping parts rather than by drawing seven people, and
   for what `tweak` is for.
   ========================================================================= */

export function Avatar({
  face,
  tweak,
  size = 72,
  shape = 'circle',
  ring = false,
  className = '',
}: {
  face: FaceKey
  /** parts swapped over the base character — the builder's live preview */
  tweak?: Partial<Face>
  size?: number
  /** squircle is the builder's swatch shape; the circle is everywhere else */
  shape?: 'circle' | 'squircle'
  /** the terracotta halo that marks a selected tile */
  ring?: boolean
  className?: string
}) {
  const f = resolveFace(face, tweak)
  return (
    <span
      aria-hidden="true"
      className={`block flex-none overflow-hidden ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: shape === 'squircle' ? Math.round(size * 0.26) : '50%',
        background: f.bg,
        boxShadow: ring ? '0 0 0 2px var(--gr-terra)' : undefined,
      }}
    >
      <FaceArt face={face} tweak={tweak} />
    </span>
  )
}

/** The drawing on its own, with no shell around it — used inside the circle,
    where the seat itself is already a masked, ringed shape. */
export function FaceArt({
  face,
  tweak,
  flat = false,
}: {
  face: FaceKey
  tweak?: Partial<Face>
  flat?: boolean
}) {
  const f = resolveFace(face, tweak)
  const parts = partsOf(f)
  return (
    <svg viewBox="0 0 100 100" className="block h-full w-full">
      {!flat && <rect x="0" y="0" width="100" height="100" fill={f.bg} />}
      {/* shoulders, then the neck behind the jaw, then hair, face, hair again */}
      <path d="M8 100 C12 81 29 74 50 74 C71 74 88 81 92 100 Z" fill={f.top} />
      <path d="M43 55 h14 v14 h-14 Z" fill={f.skinShade} />
      <path d={parts.hairBack} fill={f.hair} />
      <ellipse cx="32" cy="47" rx="3.2" ry="4.2" fill={f.skinShade} />
      <ellipse cx="68" cy="47" rx="3.2" ry="4.2" fill={f.skinShade} />
      <ellipse cx="50" cy="42" rx="17.5" ry="19.5" fill={f.skin} />
      {parts.beard && <path d={parts.beard} fill={f.hair} />}
      <path d={parts.hairFront} fill={f.hair} />
      <ellipse cx="42.6" cy="45" rx="1.9" ry="2.3" fill={f.ink} />
      <ellipse cx="57.4" cy="45" rx="1.9" ry="2.3" fill={f.ink} />
      <path
        d="M45.5 53.5 q4.5 3.4 9 0"
        fill="none"
        stroke={f.ink}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      {parts.accessory && (
        <path
          d={parts.accessory}
          fill="none"
          stroke={f.ink}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}
