import { describe, portraitOf, type AvatarLook } from '../model/avatar'

/* ============================================================================
   One portrait, shown at whatever size it is given.

   Always masked to a circle. That is the shape of a seat, and it also hides
   the corner mark some of the source portraits carry (see model/avatar.ts).
   The images are 512px, which stays sharp from the 34px chat gutter to the
   196px preview on a 2x screen.
   ========================================================================= */

export function Avatar({
  look,
  size = 72,
  ring = false,
  className = '',
}: {
  look: AvatarLook
  size?: number
  /** the terracotta halo that marks a selected tile */
  ring?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={`block flex-none overflow-hidden rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        background: portraitOf(look).seat,
        boxShadow: ring ? '0 0 0 2px var(--gr-terra)' : undefined,
      }}
    >
      <AvatarArt look={look} />
    </span>
  )
}

/** The portrait on its own, with no shell around it. Used inside the circle,
    where the seat itself is already a masked, ringed shape. */
export function AvatarArt({ look, label = false }: { look: AvatarLook; label?: boolean }) {
  const p = portraitOf(look)
  return (
    <img
      src={p.src}
      alt={label ? describe(p) : ''}
      draggable={false}
      decoding="async"
      className="block h-full w-full select-none object-cover"
    />
  )
}
