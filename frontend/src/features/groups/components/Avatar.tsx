import { useId } from 'react'
import {
  HAIR_COLOURS,
  OUTFIT_COLOURS,
  SKIN_TONES,
  describe,
  portraitOf,
  type AvatarLook,
  type Swatch,
} from '../model/avatar'
import { normaliseTable, ramp, useLayers, type Layer } from '../model/recolour'

/* ============================================================================
   One portrait, as an SVG, shown at whatever size it is given.

   The painted portrait is the bottom layer. Each part the member recoloured
   (hair, skin, outfit) is drawn again on top: the same image, clipped to that
   part's soft mask, through a filter that maps its light and dark onto the
   chosen colour. Parts left as painted add nothing. A look with no colours
   changed is a single image.

   Always masked to a circle. That is the shape of a seat, and it also hides
   the corner mark some of the source portraits carry (see model/avatar.ts).
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

type Part = 'hair' | 'skin' | 'outfit' | 'beard'

const LISTS: { part: 'hair' | 'skin' | 'outfit'; list: Swatch<string>[] }[] = [
  { part: 'skin', list: SKIN_TONES },
  { part: 'outfit', list: OUTFIT_COLOURS },
  { part: 'hair', list: HAIR_COLOURS },
]

/** The portrait on its own, with no shell around it. Used inside the circle,
    where the seat itself is already a masked, ringed shape. */
export function AvatarArt({ look, label = false }: { look: AvatarLook; label?: boolean }) {
  const p = portraitOf(look)
  const recoloured = Boolean(look.hair || look.skin || look.outfit)
  const layers = useLayers(p.id, recoloured)
  const raw = useId().replace(/[^a-zA-Z0-9]/g, '')
  const id = (name: string) => `av${raw}-${name}`
  const title = label ? describe(p) : undefined

  /* Skin first and hair last: where a soft mask edge overlaps another part,
     the hair is the one that should sit on top, as it does on a head. */
  const parts: { part: Part; layer: Layer; colour: [number, number, number] }[] = layers
    ? LISTS.flatMap(({ part, list }) => {
        const chosen = list.find((s) => s.id === look[part])
        if (!chosen) return []
        const own = { part, layer: layers[part], colour: chosen.lch }
        /* a full beard follows the hair, drawn just before it */
        return part === 'hair' && layers.beard
          ? [{ part: 'beard' as const, layer: layers.beard, colour: chosen.lch }, own]
          : [own]
      })
    : []

  return (
    <svg
      viewBox="0 0 100 100"
      className="block h-full w-full select-none"
      role={label ? 'img' : undefined}
      aria-label={title}
      aria-hidden={label ? undefined : true}
    >
      {parts.length > 0 && (
        <defs>
          <filter id={id('feather')} x="-5%" y="-5%" width="110%" height="110%">
            <feGaussianBlur stdDeviation="0.45" />
          </filter>
          {/* a beard's mask is cut along the jaw and under the nose, and both
              cuts have to vanish into the stubble around them */}
          <filter id={id('feather-wide')} x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="1.4" />
          </filter>
          {parts.map(({ part, layer, colour }) => (
            <g key={part}>
              <mask id={id(`m-${part}`)} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
                <path
                  d={layer.d}
                  fill="#fff"
                  filter={`url(#${id(part === 'beard' ? 'feather-wide' : 'feather')})`}
                />
              </mask>
              <RecolourFilter id={id(`f-${part}`)} layer={layer} colour={colour} part={part} />
            </g>
          ))}
        </defs>
      )}
      <image href={p.src} x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid slice" />
      {parts.map(({ part }) => (
        /* A beard's edge fades into skin, so its colour goes on lighter and
           the stubble at its border keeps some of the skin under it. */
        <g key={part} mask={`url(#${id(`m-${part}`)})`} opacity={part === 'beard' ? 0.82 : undefined}>
          <image
            href={p.src}
            x="0"
            y="0"
            width="100"
            height="100"
            preserveAspectRatio="xMidYMid slice"
            filter={`url(#${id(`f-${part}`)})`}
          />
        </g>
      ))}
    </svg>
  )
}

/** Brightness, normalised to the region's own range, looked up in a ramp
    built from the chosen colour. sRGB throughout: the ramp is sRGB, and so
    is the brightness the build script measured. */
function RecolourFilter({
  id,
  layer,
  colour,
  part,
}: {
  id: string
  layer: Layer
  colour: [number, number, number]
  part: Part
}) {
  const stops = ramp(colour, part)
  const table = (ch: 0 | 1 | 2) => stops.map((s) => s[ch].toFixed(3)).join(' ')
  const norm = normaliseTable(layer.lum)
  return (
    <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feColorMatrix
        type="matrix"
        values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"
      />
      <feComponentTransfer>
        <feFuncR type="table" tableValues={norm} />
        <feFuncG type="table" tableValues={norm} />
        <feFuncB type="table" tableValues={norm} />
      </feComponentTransfer>
      <feComponentTransfer>
        <feFuncR type="table" tableValues={table(0)} />
        <feFuncG type="table" tableValues={table(1)} />
        <feFuncB type="table" tableValues={table(2)} />
      </feComponentTransfer>
    </filter>
  )
}
