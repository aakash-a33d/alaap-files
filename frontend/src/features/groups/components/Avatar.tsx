import { useId, type ReactNode } from 'react'
import { COVERED, HAIR, paletteOf, type AvatarLook, type Outfit } from '../model/avatar'

/* ============================================================================
   One portrait, drawn at whatever size it is given.

   The whole set is a single 100×100 viewBox with the same parts in the same
   order, so the drawing scales from a 34px chat gutter to a 196px preview
   without a second asset and without going soft. See model/avatar.ts for why
   it is layered SVG and not a painted set.

   Order, back to front: backdrop, hair behind the head, the body, the neck,
   the collar, the ears, the face and what is on it, hair in front, glasses.
   The shading — light on the face, sheen on the hair, folds on the cloth — is
   laid over the flat shapes rather than baked into them, which is what lets
   any skin tone or outfit take the same light.

   Gradient ids come from useId: eight seats, a chat column and a builder can
   all be on one page, and two portraits sharing an id would draw each other's
   colours.
   ========================================================================= */

/** The face, kept as one path because the hair shadow is clipped to it. */
const HEAD =
  'M50 21 C61.5 21 69.5 29.5 69.5 42.5 C69.5 50 68 56 64.5 61 C60.5 66.5 55.5 69.5 50 69.5 C44.5 69.5 39.5 66.5 35.5 61 C32 56 30.5 50 30.5 42.5 C30.5 29.5 38.5 21 50 21 Z'

/** Shoulders and chest. Every outfit starts from this silhouette. */
const BODY =
  'M4 100 C6 87 15 80.5 29 77.5 C36 76 42 75 50 75 C58 75 64 76 71 77.5 C85 80.5 94 87 96 100 Z'

const BEARD =
  'M31.4 46 C31.2 56 34.4 63.6 39.6 67.8 C43.2 70.8 46.4 72.2 50 72.2 C53.6 72.2 56.8 70.8 60.4 67.8 C65.6 63.6 68.8 56 68.6 46 C67.6 52.6 65.6 56.6 62 58.2 C59 59.4 57.4 58 55 58.2 C53 58.4 51.6 59.2 50 59.2 C48.4 59.2 47 58.4 45 58.2 C42.6 58 41 59.4 38 58.2 C34.4 56.6 32.4 52.6 31.4 46 Z'

const MOUSTACHE =
  'M43.4 60.6 C45.4 58 48.4 58.2 50 59.4 C51.6 58.2 54.6 58 56.6 60.6 C54.2 60.2 52 60.4 50 60.8 C48 60.4 45.8 60.2 43.4 60.6 Z'

const EYES: [number, number][] = [
  [41.6, 47.4],
  [58.4, 47.4],
]

export function Avatar({
  look,
  size = 72,
  shape = 'circle',
  ring = false,
  className = '',
}: {
  look: AvatarLook
  size?: number
  /** squircle is the builder's swatch shape; the circle is everywhere else */
  shape?: 'circle' | 'squircle'
  /** the terracotta halo that marks a selected tile */
  ring?: boolean
  className?: string
}) {
  const p = paletteOf(look)
  return (
    <span
      aria-hidden="true"
      className={`block flex-none overflow-hidden ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: shape === 'squircle' ? Math.round(size * 0.26) : '50%',
        background: p.backdrop.seat,
        boxShadow: ring ? '0 0 0 2px var(--gr-terra)' : undefined,
      }}
    >
      <AvatarArt look={look} />
    </span>
  )
}

/** The drawing on its own, with no shell around it — used inside the circle,
    where the seat itself is already a masked, ringed shape. */
export function AvatarArt({ look }: { look: AvatarLook }) {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, '')
  const id = (name: string) => `av${raw}-${name}`
  const url = (name: string) => `url(#${id(name)})`
  const p = paletteOf(look)
  const hair = HAIR[look.hair]
  const covered = COVERED.has(look.hair)
  const hairFill = covered ? p.covering : p.hair
  const ink = 'oklch(0.22 0.02 40)'

  return (
    <svg viewBox="0 0 100 100" className="block h-full w-full">
      <defs>
        <radialGradient id={id('bg')} cx="28%" cy="22%" r="95%">
          <stop offset="0%" stopColor={p.backdrop.from} />
          <stop offset="100%" stopColor={p.backdrop.to} />
        </radialGradient>
        {/* the key light sits up and to the left, as in every reference */}
        <radialGradient id={id('skin')} cx="42%" cy="36%" r="68%">
          <stop offset="0%" stopColor={p.skinLight} />
          <stop offset="55%" stopColor={p.skin} />
          <stop offset="100%" stopColor={p.skinShade} />
        </radialGradient>
        <linearGradient id={id('neck')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.skinDeep} />
          <stop offset="55%" stopColor={p.skinShade} />
          <stop offset="100%" stopColor={p.skin} />
        </linearGradient>
        <radialGradient id={id('nose')} cx="45%" cy="40%" r="60%">
          <stop offset="0%" stopColor={p.skinLight} stopOpacity="0.9" />
          <stop offset="100%" stopColor={p.skin} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('blush')}>
          <stop offset="0%" stopColor={p.blush} stopOpacity="0.55" />
          <stop offset="100%" stopColor={p.blush} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('iris')} cx="50%" cy="62%" r="55%">
          <stop offset="0%" stopColor="oklch(0.64 0.12 62)" />
          <stop offset="55%" stopColor="oklch(0.46 0.09 50)" />
          <stop offset="100%" stopColor="oklch(0.26 0.04 40)" />
        </radialGradient>
        <radialGradient id={id('white')} cx="50%" cy="40%" r="60%">
          <stop offset="60%" stopColor="#fdfbf8" />
          <stop offset="100%" stopColor="oklch(0.86 0.015 60)" />
        </radialGradient>
        {/* sheen over hair or cloth: lit across the crown, falling to shadow */}
        <linearGradient id={id('sheen')} x1="0.3" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.3" />
          <stop offset="35%" stopColor="#fff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.3" />
        </linearGradient>
        {/* the folds of the clothes: light at the chest, darker at the arms */}
        <radialGradient id={id('fold')} cx="46%" cy="10%" r="95%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="45%" stopColor="#fff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.32" />
        </radialGradient>
        <filter id={id('soft')} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.3" />
        </filter>
        <clipPath id={id('head')}>
          <path d={HEAD} />
        </clipPath>
        {EYES.map(([cx, cy], i) => (
          <clipPath key={i} id={id(`eye${i}`)}>
            <ellipse cx={cx} cy={cy} rx="5.4" ry="5" />
          </clipPath>
        ))}
      </defs>

      <rect x="0" y="0" width="100" height="100" fill={url('bg')} />

      {/* ---- behind the head ---------------------------------------------- */}
      {hair.back && (
        <g>
          <path d={hair.back} fill={p.hairShadow} />
          <path d={hair.back} fill={url('sheen')} opacity="0.6" />
        </g>
      )}

      {/* ---- body, neck, collar ------------------------------------------- */}
      <Clothes outfit={look.outfit} p={p} url={url} skinNeck={url('neck')} />

      {/* ---- the head ----------------------------------------------------- */}
      {EYES.map((_, i) => {
        const x = i === 0 ? 30.8 : 69.2
        return (
          <g key={`ear${i}`}>
            <ellipse cx={x} cy={48} rx="3.8" ry="5.2" fill={p.skinShade} />
            <ellipse cx={x + (i === 0 ? 0.8 : -0.8)} cy={48} rx="1.7" ry="2.8" fill={p.skinDeep} opacity="0.45" />
            {look.earrings && !covered && (
              <circle cx={x} cy={53.6} r="1.6" fill="none" stroke="oklch(0.78 0.12 82)" strokeWidth="0.9" />
            )}
          </g>
        )
      })}
      <path d={HEAD} fill={url('skin')} />

      {/* the fringe throws a shadow on the forehead, kept inside the face */}
      <g clipPath={url('head')}>
        <path
          d={hair.front}
          fill={p.skinDeep}
          opacity="0.4"
          transform="translate(0 1.8)"
          filter={url('soft')}
          fillRule={hair.evenodd ? 'evenodd' : undefined}
        />
      </g>

      {/* cheeks */}
      <ellipse cx="37.6" cy="56.2" rx="5" ry="3.4" fill={url('blush')} />
      <ellipse cx="62.4" cy="56.2" rx="5" ry="3.4" fill={url('blush')} />
      {look.freckles && (
        <g fill={p.skinDeep} opacity="0.45">
          {[
            [44, 54.4],
            [45.8, 53.2],
            [42.6, 55.6],
            [56, 54.4],
            [54.2, 53.2],
            [57.4, 55.6],
            [47.6, 52.8],
            [52.4, 52.8],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="0.42" />
          ))}
        </g>
      )}

      {/* brows */}
      <g fill="none" stroke={p.brow} strokeWidth="2.1" strokeLinecap="round">
        <path d="M35.6 40 C38 37.4 42.4 36.6 46.4 37.8" />
        <path d="M64.4 40 C62 37.4 57.6 36.6 53.6 37.8" />
      </g>

      {/* eyes: white, iris, pupil, two catch-lights, the lash line on top */}
      {EYES.map(([cx, cy], i) => (
        <g key={`eye${i}`}>
          <ellipse cx={cx} cy={cy} rx="5.4" ry="5" fill={url('white')} />
          <g clipPath={url(`eye${i}`)}>
            <circle cx={cx + (i === 0 ? 0.5 : -0.5)} cy={cy + 0.5} r="3.75" fill={url('iris')} />
            <circle cx={cx + (i === 0 ? 0.5 : -0.5)} cy={cy + 0.5} r="1.9" fill="oklch(0.16 0.02 40)" />
            {/* the upper lid's shadow across the top of the eye */}
            <ellipse cx={cx} cy={cy - 5.2} rx="6" ry="2.6" fill={p.skinDeep} opacity="0.28" />
          </g>
          <circle cx={cx + 1.6} cy={cy - 0.9} r="1.15" fill="#fff" />
          <circle cx={cx - 1} cy={cy + 2} r="0.5" fill="#fff" opacity="0.75" />
          <path
            d={`M${cx - 5.8} ${cy + 0.4} C${cx - 4.6} ${cy - 5.9} ${cx + 4.6} ${cy - 5.9} ${cx + 5.8} ${cy + 0.4}`}
            fill="none"
            stroke={ink}
            strokeWidth="1.1"
            strokeLinecap="round"
          />
          <path
            d={i === 0 ? `M${cx - 5.8} ${cy + 0.4} l-1.1 -1.1` : `M${cx + 5.8} ${cy + 0.4} l1.1 -1.1`}
            stroke={ink}
            strokeWidth="0.9"
            strokeLinecap="round"
          />
          <path
            d={`M${cx - 4.2} ${cy + 4.2} C${cx - 2} ${cy + 5.6} ${cx + 2} ${cy + 5.6} ${cx + 4.2} ${cy + 4.2}`}
            fill="none"
            stroke={p.skinDeep}
            strokeWidth="0.6"
            opacity="0.45"
          />
        </g>
      ))}

      {/* nose: a lit bulb and two soft nostrils, no outline */}
      <path
        d="M48.6 50.6 C48 53 47 54.6 47.4 56.2"
        fill="none"
        stroke={p.skinShade}
        strokeWidth="0.9"
        strokeLinecap="round"
        opacity="0.8"
      />
      <ellipse cx="50" cy="55.6" rx="3.3" ry="2.5" fill={url('nose')} />
      <ellipse cx="48.3" cy="57.3" rx="0.9" ry="0.5" fill={p.skinDeep} opacity="0.55" />
      <ellipse cx="51.7" cy="57.3" rx="0.9" ry="0.5" fill={p.skinDeep} opacity="0.55" />

      {look.facialHair !== 'none' && (
        <g opacity={look.facialHair === 'stubble' ? 0.32 : 1}>
          <path d={BEARD} fill={p.hair} />
          <path d={MOUSTACHE} fill={p.hair} />
          {look.facialHair === 'beard' && <path d={BEARD} fill={url('sheen')} opacity="0.7" />}
        </g>
      )}

      {/* the closed, gentle smile, with a light on the lower lip */}
      <path
        d="M44.6 61.4 C47 63.9 53 63.9 55.4 61.4"
        fill="none"
        stroke={p.lip}
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <path
        d="M47.6 64 C49 64.8 51 64.8 52.4 64"
        fill="none"
        stroke={p.skinLight}
        strokeWidth="0.8"
        strokeLinecap="round"
        opacity="0.7"
      />

      {look.bindi && !covered && <circle cx="50" cy="37.4" r="1.1" fill="oklch(0.45 0.16 25)" />}
      {look.bindi && covered && look.hair === 'scarf' && (
        <circle cx="50" cy="38.6" r="1.1" fill="oklch(0.45 0.16 25)" />
      )}

      {/* ---- hair in front ------------------------------------------------ */}
      <g fillRule={hair.evenodd ? 'evenodd' : undefined}>
        <path d={hair.front} fill={hairFill} />
        <path d={hair.front} fill={url('sheen')} />
      </g>
      {hair.strands && (
        <path
          d={hair.strands}
          fill="none"
          stroke={covered ? 'oklch(0.3 0.08 20)' : p.hairLight}
          strokeWidth="0.7"
          strokeLinecap="round"
          opacity={covered ? 0.5 : 0.55}
        />
      )}

      {look.glasses && (
        <g fill="none" stroke="oklch(0.2 0.02 40)" strokeWidth="1.15" strokeLinecap="round">
          {EYES.map(([cx, cy]) => (
            <rect
              key={`g${cx}`}
              x={cx - 7.4}
              y={cy - 5.8}
              width="14.8"
              height="11"
              rx="4"
              fill="#fff"
              fillOpacity="0.08"
            />
          ))}
          <path d="M48.8 46.4 C49.5 45.4 50.5 45.4 51.2 46.4" />
          <path d="M34.2 45.6 L31 44.8 M65.8 45.6 L69 44.8" />
        </g>
      )}
    </svg>
  )
}

/* --- Clothes -------------------------------------------------------------- */

type Palette = ReturnType<typeof paletteOf>

/** The body, the neck over it, and whatever collar sits over the neck. Each
    outfit is the shared silhouette in its main colour plus a few shapes; the
    fold gradient laid over the whole body afterwards is what makes all ten
    read as cloth on shoulders rather than coloured paper. */
function Clothes({
  outfit,
  p,
  url,
  skinNeck,
}: {
  outfit: Outfit
  p: Palette
  url: (name: string) => string
  skinNeck: string
}) {
  const o = p.outfit
  const neck = (
    <>
      <path d="M42.4 56 L57.6 56 L58.6 79 L41.4 79 Z" fill={skinNeck} />
      {/* the chin's shadow falling on the neck */}
      <ellipse cx="50" cy="67.5" rx="9.5" ry="4" fill={p.skinDeep} opacity="0.5" filter={url('soft')} />
    </>
  )
  const details = OUTFIT_PARTS[outfit](o, p)
  return (
    <g>
      <path d={BODY} fill={details.base ?? o.main} />
      {details.under}
      {neck}
      {details.over}
      <path d={BODY} fill={url('fold')} />
      {/* the shadow the head throws on the chest */}
      <ellipse cx="50" cy="79" rx="13" ry="3" fill="#000" opacity="0.14" filter={url('soft')} />
    </g>
  )
}

type Parts = { base?: string; under?: ReactNode; over?: ReactNode }
type O = Palette['outfit']

/** A shirt collar: two points meeting at the throat. */
const collar = (fill: string, edge: string) => (
  <g fill={fill} stroke={edge} strokeWidth="0.5" strokeLinejoin="round">
    <path d="M42.8 75.6 L39.2 82.6 L46.8 85.8 L50 79.6 Z" />
    <path d="M57.2 75.6 L60.8 82.6 L53.2 85.8 L50 79.6 Z" />
  </g>
)

/** A jacket's collar, spread open and lying on the shoulders, so the tee
    under it shows at the throat. */
const spread = (fill: string, edge: string) => (
  <g fill={fill} stroke={edge} strokeWidth="0.5" strokeLinejoin="round">
    <path d="M41.6 75.4 C37.4 76.4 33.6 78.2 30.6 80.6 L38.4 85.6 L43.2 80.4 Z" />
    <path d="M58.4 75.4 C62.6 76.4 66.4 78.2 69.4 80.6 L61.6 85.6 L56.8 80.4 Z" />
  </g>
)

/** Two front panels of an open jacket or cardigan, leaving a gap at the
    chest for whatever is underneath. */
const panels = (fill: string, gap = 4) => (
  <g fill={fill}>
    <path d={`M4 100 C6 87 15 80.5 29 77.5 C34 76.6 38 76 41.4 75.6 C39.4 82 ${43 - gap} 92 ${50 - gap} 100 Z`} />
    <path d={`M96 100 C94 87 85 80.5 71 77.5 C66 76.6 62 76 58.6 75.6 C60.6 82 ${57 + gap} 92 ${50 + gap} 100 Z`} />
  </g>
)

/** The ribbed band round a crew neck. */
const crew = (stroke: string) => (
  <path
    d="M40.6 76.4 C43 81.6 57 81.6 59.4 76.4"
    fill="none"
    stroke={stroke}
    strokeWidth="2.8"
    strokeLinecap="round"
  />
)

const ribs = (stroke: string, step = 5) => (
  <g stroke={stroke} strokeWidth="0.55" opacity="0.35">
    {Array.from({ length: Math.floor(70 / step) }, (_, i) => {
      const x = 15 + i * step
      return <path key={x} d={`M${x} ${84 + Math.abs(x - 50) * 0.12} L${x + (x - 50) * 0.06} 100`} />
    })}
  </g>
)

const OUTFIT_PARTS: Record<Outfit, (o: O, p: Palette) => Parts> = {
  knit: (o) => ({ over: <>{crew(o.trim)}{ribs(o.trim)}</> }),

  cable: (o) => ({
    over: (
      <>
        {crew(o.trim)}
        {/* two cables either side of the chest */}
        <g fill="none" stroke={o.trim} strokeWidth="1.1" opacity="0.8">
          <path d="M38 84 c-2 2 2 4 0 6 c-2 2 2 4 0 6 c-2 2 2 4 0 6" />
          <path d="M62 84 c2 2 -2 4 0 6 c2 2 -2 4 0 6 c2 2 -2 4 0 6" />
        </g>
        {ribs(o.trim, 6)}
      </>
    ),
  }),

  cardigan: (o) => ({
    base: o.under,
    over: (
      <>
        {collar(o.under, 'oklch(0.8 0.02 85)')}
        <path d="M50 80 L50 100" stroke="oklch(0.8 0.02 85)" strokeWidth="0.5" />
        <circle cx="50" cy="90" r="0.9" fill="oklch(0.82 0.02 85)" />
        <circle cx="50" cy="97" r="0.9" fill="oklch(0.82 0.02 85)" />
        {panels(o.main, 3)}
        {/* the shawl collar's rolled edge */}
        <g fill="none" stroke={o.trim} strokeWidth="3.2" strokeLinecap="round">
          <path d="M40.6 76.4 C38.8 83 41.6 92 46.4 99" />
          <path d="M59.4 76.4 C61.2 83 58.4 92 53.6 99" />
        </g>
      </>
    ),
  }),

  blazer: (o) => ({
    base: o.under,
    over: (
      <>
        {crew('oklch(0.9 0.01 90)')}
        {panels(o.main, 5)}
        {/* lapels */}
        <g fill={o.trim}>
          <path d="M41.4 75.6 L39.6 84 L42.4 85.6 L45 100 L44 100 C41 92 38.6 84 41.4 75.6 Z" />
          <path d="M58.6 75.6 L60.4 84 L57.6 85.6 L55 100 L56 100 C59 92 61.4 84 58.6 75.6 Z" />
        </g>
      </>
    ),
  }),

  saree: (o, p) => ({
    over: (
      <>
        {/* the blouse's round neck, skin showing above it */}
        <path d="M41.4 76 C42 83 46 86 50 86 C54 86 58 83 58.6 76 Z" fill={p.skin} />
        <path d="M41.4 76 C42 83 46 86 50 86 C54 86 58 83 58.6 76" fill="none" stroke={o.trim} strokeWidth="1.1" />
        {/* the pallu over the left shoulder, crossing the chest */}
        <path d="M61 77.4 C70 76.8 80 79 88 84 C93 88 95.6 94 96 100 L33 100 C43 94 53 86 61 77.4 Z" fill={o.under} />
        <path d="M33 100 C43 94 53 86 61 77.4" fill="none" stroke={o.trim} strokeWidth="3" />
        <path d="M35.6 100 C45 94.4 54.6 86.6 62.6 78.4" fill="none" stroke="oklch(0.74 0.1 80)" strokeWidth="0.6" />
        <g fill="oklch(0.5 0.08 30)" opacity="0.7">
          {[
            [70, 86],
            [79, 89],
            [87, 93],
            [62, 93],
            [73, 95],
            [83, 98],
            [55, 98],
          ].map(([x, y]) => (
            <ellipse key={`${x}-${y}`} cx={x} cy={y} rx="1.4" ry="1.8" />
          ))}
        </g>
      </>
    ),
  }),

  kurta: (o) => ({
    over: (
      <>
        {/* mandarin collar and the placket below it */}
        <path d="M41.4 75 C44 77.6 56 77.6 58.6 75 L58.8 78.4 C56 81 44 81 41.2 78.4 Z" fill={o.under} />
        <path d="M48.6 80.4 L51.4 80.4 L51.4 96 L48.6 96 Z" fill={o.under} />
        <g fill={o.trim}>
          <circle cx="50" cy="84" r="0.8" />
          <circle cx="50" cy="88.5" r="0.8" />
          <circle cx="50" cy="93" r="0.8" />
        </g>
      </>
    ),
  }),

  hoodie: (o) => ({
    over: (
      <>
        {/* the hood, bunched round the back of the neck */}
        <path
          d="M34.6 79 C35.4 73 40.6 71 43.4 71.6 L44 79 C46 82.4 54 82.4 56 79 L56.6 71.6 C59.4 71 64.6 73 65.4 79 C60 85.4 40 85.4 34.6 79 Z"
          fill={o.under}
        />
        <g stroke={o.trim} strokeWidth="1" strokeLinecap="round">
          <path d="M45.6 82.4 C45.2 87 45.4 91 45 95" />
          <path d="M54.4 82.4 C54.8 87 54.6 91 55 95" />
        </g>
        <circle cx="45" cy="95.4" r="0.9" fill="oklch(0.7 0.01 80)" />
        <circle cx="55" cy="95.4" r="0.9" fill="oklch(0.7 0.01 80)" />
      </>
    ),
  }),

  denim: (o) => ({
    base: o.under,
    over: (
      <>
        {crew('oklch(0.82 0.13 95)')}
        {panels(o.main, 6)}
        {spread(o.main, 'oklch(0.42 0.06 255)')}
        <g fill="none" stroke={o.trim} strokeWidth="0.45" strokeDasharray="1 0.8" opacity="0.9">
          <path d="M43 100 C40 92 38.6 85 40 78" />
          <path d="M57 100 C60 92 61.4 85 60 78" />
          <rect x="24" y="88" width="10" height="7" rx="1" />
          <rect x="66" y="88" width="10" height="7" rx="1" />
        </g>
      </>
    ),
  }),

  overshirt: (o) => ({
    base: o.under,
    over: (
      <>
        {crew('oklch(0.72 0.12 85)')}
        {panels(o.main, 7)}
        {spread(o.main, o.trim)}
        <circle cx="42.4" cy="94" r="0.8" fill="oklch(0.6 0.05 60)" />
      </>
    ),
  }),

  layered: (o) => ({
    over: (
      <>
        {crew(o.trim)}
        {ribs(o.trim)}
        {collar(o.under, 'oklch(0.7 0.06 255)')}
      </>
    ),
  }),
}
