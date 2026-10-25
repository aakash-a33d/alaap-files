/* ============================================================================
   The character set — one stand-in per member.

   Soft, lit, head-and-shoulders portraits in the manner of an animated film:
   a big rounded head, large brown eyes with a catch-light, a closed smile, and
   a backdrop that is a gradient rather than a flat tile. They are layered SVG
   rather than painted images because the member changes three things
   independently — hair, skin, outfit — and a painted set would need every
   combination drawn and lined up by hand. Here each part is one shape, and the
   3D look comes from shading laid over it: a radial light on the face, a
   sheen over the hair, a fold gradient over the clothes, and soft shadows
   where one part sits on another.

   Every look is the same skeleton with parts swapped. Seven people in a circle
   have to be told apart at 34px and still read as one group rather than seven
   clip-art styles, so the head, eyes and smile are shared and only what a
   person would actually change is choosable.

   A look is stored as keys, never as colours. A key survives the palette being
   retuned; a stored colour would pin every member to the shade it had the day
   they saved it. The same key lists are validated by pseudonym-service
   (src/domain/avatar.ts) — a key added here must be added there too.

   Nothing here is derived from the member. No photo, no camera frame, nothing
   from the identity vault: the look is only what they picked, and the default
   is the same for everybody.

   The therapist has no avatar. Nobody in the group is given a drawn face by
   the platform except the members themselves, and a therapist who wears one
   starts to look like a peer.
   ========================================================================= */

/* --- Hair ----------------------------------------------------------------- */

export type HairStyle =
  | 'waves'
  | 'curls'
  | 'bob'
  | 'bun'
  | 'swept'
  | 'tousled'
  | 'crop'
  | 'turban'
  | 'scarf'

/** Every hair choice, in the order the builder offers them. */
export const HAIR_STYLES: { id: HairStyle; label: string }[] = [
  { id: 'waves', label: 'Long waves' },
  { id: 'curls', label: 'Curls' },
  { id: 'bob', label: 'Shaggy bob' },
  { id: 'bun', label: 'Low bun' },
  { id: 'swept', label: 'Swept back' },
  { id: 'tousled', label: 'Tousled' },
  { id: 'crop', label: 'Short crop' },
  { id: 'turban', label: 'Turban' },
  { id: 'scarf', label: 'Head scarf' },
]

/** Head coverings are cloth, not hair: they take their own colour and leave
    the hair shade to the brows and any beard. */
export const COVERED: ReadonlySet<HairStyle> = new Set<HairStyle>(['turban', 'scarf'])

/** Hair is drawn in two pieces either side of the face: the mass behind the
    head (and behind the shoulders, for long hair), and everything in front of
    it — fringe, side locks, the drape of a scarf. `strands` are a few light
    strokes laid on top so the shape reads as hair rather than a cut-out.
    `evenodd` marks a front piece with a hole cut for the face. */
export const HAIR: Record<
  HairStyle,
  { back?: string; front: string; strands?: string; evenodd?: boolean }
> = {
  waves: {
    back: 'M27 40 C27 22 38 15 50 15 C62 15 73 22 73 40 L75 74 C68 80 32 80 25 74 Z',
    front:
      'M50 16.5 C36 16.5 28 26 27.5 38 C27 48 28 56 24.5 64 C21.5 71 23 80 27 86 C30 89.5 35.5 88.5 36.5 84 C33.5 79 34 73 33 66 C32 58 31 50 32.5 43 C35 36 41 31 47 29 C55 27 62 30 66 35 C68 40 68.5 48 68 56 C67.5 64 67 72 64.5 80 C65.5 86 71 89 74.5 85.5 C78.5 80 78 71 75.5 64 C72.5 56 73 48 72.5 38 C72 26 64 16.5 50 16.5 Z',
    strands:
      'M46 20 C38 23 33 30 31 40 M58 21 C65 25 69 32 70 42 M29 60 C27 68 27 76 30 83 M71 60 C73 68 73 76 70 83 M44 30 C52 25 60 27 64 32',
  },
  curls: {
    back: 'M25 44 C25 22 37 13.5 50 13.5 C63 13.5 75 22 75 44 C80 52 81 64 78 74 C74 82 66 82 50 82 C34 82 26 82 22 74 C19 64 20 52 25 44 Z',
    front:
      'M50 15 C37 15 28.5 25 28 39 C27.5 51 30 60 26.5 69 C24 77 27.5 86 34 86.5 C36.5 80 34 72 34 64 C33.5 54 33 46 35 40 C38 33 44 29.5 50 28.5 C56 29.5 62 33 65 40 C67 46 66.5 54 66 64 C66 72 63.5 80 66 86.5 C72.5 86 76 77 73.5 69 C70 60 72.5 51 72 39 C71.5 25 63 15 50 15 Z',
    strands:
      'M31 46 c-2 2 -2 5 0 6 c2 1 3 -2 1 -3 M30 62 c-2 2 -2 5 0 6 c2 1 3 -2 1 -3 M30 76 c-2 2 -2 5 0 6 c2 1 3 -2 1 -3 M69 46 c2 2 2 5 0 6 c-2 1 -3 -2 -1 -3 M70 62 c2 2 2 5 0 6 c-2 1 -3 -2 -1 -3 M70 76 c2 2 2 5 0 6 c-2 1 -3 -2 -1 -3 M40 21 c-2 1 -2 4 0 5 c2 1 3 -2 1 -3 M58 20 c2 1 2 4 0 5 c-2 1 -3 -2 -1 -3',
  },
  bob: {
    back: 'M26 40 C26 22 37 14.5 50 14.5 C63 14.5 74 22 74 40 L75.5 70 C68 74 32 74 24.5 70 Z',
    front:
      'M50 14.5 C35 14.5 26 25 25.5 40 C25 52 26 62 23.5 70.5 C28 73.5 32 72.5 34.5 69.5 C32.5 62 31.5 54 31.8 46 C33 41 34.5 39 36 38.2 C39 40 42 39 44 36.2 C47 39 51 39.6 54 36.8 C57 39.6 61 39.6 63.6 37.4 C65.6 39 67.4 42 68.2 46 C68.5 54 67.6 62 65.5 69.5 C68 72.5 72 73.5 76.5 70.5 C74 62 75 52 74.5 40 C74 25 65 14.5 50 14.5 Z',
    strands:
      'M40 18 C35 22 32 28 31 36 M60 18 C65 22 68 28 69 36 M50 17 C49 24 47 30 44 36 M28 50 C27 58 27 64 26 69 M72 50 C73 58 73 64 74 69',
  },
  bun: {
    back: 'M29 44 C28 30 37 19 50 19 C63 19 72 30 71 44 C72 54 71 61 68 65 C61 69 39 69 32 65 C29 61 28 54 29 44 Z',
    front:
      'M50 19.5 C38 19.5 30.2 28 29.8 41 C29.8 45 30.3 48.5 31.4 51 C32 44 33 38 37 33 C41 29 46 28.2 50 30 C54 28.2 59 29 63 33 C67 38 68 44 68.6 51 C69.7 48.5 70.2 45 70.2 41 C69.8 28 62 19.5 50 19.5 Z',
    strands:
      'M49 21 C44 22 38 26 34.5 33 M51 21 C56 22 62 26 65.5 33 M47 24 C42 26 37 31 34 38 M53 24 C58 26 63 31 66 38',
  },
  swept: {
    front:
      'M30.4 47 C28.3 34 31 22 40 16.5 C46 12.8 56 12.4 63 16 C69.5 19.5 72.4 28 70.6 47 C69.5 41 68.5 36 66.4 32.6 C60 30 53 29.4 46 30.6 C40 31.6 35.2 33.4 33.6 36.4 C32.2 39.4 31.6 43 30.4 47 Z',
    strands:
      'M35 30 C40 22 50 18 62 19 M38 33 C44 26 53 23 64 24 M44 31 C50 27 58 26 66 28',
  },
  tousled: {
    front:
      'M29.3 49 C26 37 27.5 25 35.5 18.5 C38 15 36 12 33.5 11.5 C38 10.8 41 12.5 42.5 14 C45 11 49 9.6 52.5 11 C55 9 59.5 9.4 61.5 11.8 C60.5 13 60 14 61 14.6 C67 16 71.5 22 72.5 30 C73.6 37 72.8 43 70.8 49 C69.5 43 68.4 39 66.2 35.5 C64.5 38.6 61.4 39.6 58.2 37.4 C56 40.6 52 41.4 48.2 38.4 C45 41.4 41 41.2 39 38.2 C36.4 40.2 33.4 40 32 38 C30.8 42 30.2 45.4 29.3 49 Z',
    strands:
      'M36 24 C41 20 46 19 50 21 M52 20 C58 18 64 20 67 26 M40 30 C44 26 50 25 54 28 M58 28 C62 27 65 29 67 33',
  },
  crop: {
    front:
      'M30.8 43 C30.6 27.5 39 19.6 50 19.6 C61 19.6 69.4 27.5 69.2 43 C68 37.5 66 34 62.6 31.8 C56 30 44 30 37.4 31.8 C34 34 32 37.5 30.8 43 Z',
    strands: 'M38 25 C44 22 56 22 62 25 M36 29 C44 26.5 56 26.5 64 29',
  },
  turban: {
    front:
      'M28.6 41 C26.6 26 36.5 13 50 13 C63.5 13 73.4 26 71.4 41 C68.6 37.6 63.6 35.6 57.6 35.4 L50 38.6 L42.4 35.4 C36.4 35.6 31.4 37.6 28.6 41 Z',
    strands:
      'M30 34 C38 24 52 18 68 22 M29.5 39 C38 30 52 25 70 30 M50 38.6 C49 30 48 22 50 13.5 M42 35.5 C48 30 58 26 70.5 35',
  },
  scarf: {
    front:
      'M50 15.5 C33 15.5 25.5 28 25.5 45 C25.5 56 26 63 22 72 C18 80 16.5 88 18 100 L82 100 C83.5 88 82 80 78 72 C74 63 74.5 56 74.5 45 C74.5 28 67 15.5 50 15.5 Z M50 28.6 C59.4 28.6 66.6 35 67 44 C67.4 53 66 60 62 65 C58.6 69 54.6 71 50 71 C45.4 71 41.4 69 38 65 C34 60 32.6 53 33 44 C33.4 35 40.6 28.6 50 28.6 Z',
    strands:
      'M26 60 C30 70 33 80 32 96 M74 60 C70 70 67 80 68 96 M38 75 C44 80 56 80 62 75 M30 30 C36 22 44 19 52 19',
    evenodd: true,
  },
}

export type HairShade = 'black' | 'espresso' | 'brown' | 'chestnut' | 'grey' | 'silver'

/** Six shades, darkest first. oklch, so a highlight and a shadow can be taken
    off each at a fixed step without a second table. */
export const HAIR_SHADES: { id: HairShade; label: string; lch: [number, number, number] }[] = [
  { id: 'black', label: 'Black', lch: [0.24, 0.015, 45] },
  { id: 'espresso', label: 'Dark brown', lch: [0.31, 0.035, 45] },
  { id: 'brown', label: 'Brown', lch: [0.4, 0.055, 50] },
  { id: 'chestnut', label: 'Chestnut', lch: [0.48, 0.08, 45] },
  { id: 'grey', label: 'Grey', lch: [0.66, 0.008, 70] },
  { id: 'silver', label: 'Silver', lch: [0.8, 0.006, 80] },
]

/** The cloth of a turban or scarf. One colour, a deep one — a head covering
    is a large shape right beside the face and a bright one takes the portrait
    over. */
export const COVERING_CLOTH = 'oklch(0.44 0.09 20)'

/* --- Skin ----------------------------------------------------------------- */

export type SkinTone = 'fair' | 'wheat' | 'honey' | 'tan' | 'brown' | 'deep'

/** Six tones over the range a room in India actually holds. Kept as one ramp
    so the shade, highlight and blush of each come off it at a fixed step. */
export const SKIN_TONES: { id: SkinTone; label: string; lch: [number, number, number] }[] = [
  { id: 'fair', label: 'Fair', lch: [0.87, 0.045, 65] },
  { id: 'wheat', label: 'Wheatish', lch: [0.8, 0.06, 62] },
  { id: 'honey', label: 'Honey', lch: [0.73, 0.072, 58] },
  { id: 'tan', label: 'Tan', lch: [0.65, 0.078, 52] },
  { id: 'brown', label: 'Brown', lch: [0.55, 0.072, 46] },
  { id: 'deep', label: 'Deep', lch: [0.45, 0.06, 42] },
]

/* --- Outfit --------------------------------------------------------------- */

export type Outfit =
  | 'knit'
  | 'cardigan'
  | 'blazer'
  | 'saree'
  | 'kurta'
  | 'hoodie'
  | 'denim'
  | 'overshirt'
  | 'layered'
  | 'cable'

/** Each outfit owns its colours: the main cloth, and whatever shows under it
    or trims it. */
export const OUTFITS: { id: Outfit; label: string; main: string; under: string; trim: string }[] = [
  { id: 'knit', label: 'Crew knit', main: 'oklch(0.93 0.015 85)', under: 'oklch(0.93 0.015 85)', trim: 'oklch(0.86 0.02 80)' },
  { id: 'cardigan', label: 'Cardigan', main: 'oklch(0.34 0.035 45)', under: 'oklch(0.9 0.02 85)', trim: 'oklch(0.4 0.04 45)' },
  { id: 'blazer', label: 'Blazer', main: 'oklch(0.38 0.03 130)', under: 'oklch(0.95 0.01 90)', trim: 'oklch(0.32 0.03 130)' },
  { id: 'saree', label: 'Saree', main: 'oklch(0.42 0.1 20)', under: 'oklch(0.86 0.04 80)', trim: 'oklch(0.42 0.1 20)' },
  { id: 'kurta', label: 'Kurta', main: 'oklch(0.48 0.08 262)', under: 'oklch(0.42 0.08 262)', trim: 'oklch(0.8 0.1 85)' },
  { id: 'hoodie', label: 'Hoodie', main: 'oklch(0.84 0.15 92)', under: 'oklch(0.78 0.15 88)', trim: 'oklch(0.95 0.03 90)' },
  { id: 'denim', label: 'Denim jacket', main: 'oklch(0.5 0.07 255)', under: 'oklch(0.88 0.13 95)', trim: 'oklch(0.72 0.09 70)' },
  { id: 'overshirt', label: 'Overshirt', main: 'oklch(0.35 0.04 210)', under: 'oklch(0.78 0.13 85)', trim: 'oklch(0.3 0.035 210)' },
  { id: 'layered', label: 'Sweater & collar', main: 'oklch(0.3 0.01 260)', under: 'oklch(0.8 0.06 255)', trim: 'oklch(0.36 0.01 260)' },
  { id: 'cable', label: 'Red knit', main: 'oklch(0.52 0.16 28)', under: 'oklch(0.52 0.16 28)', trim: 'oklch(0.46 0.15 28)' },
]

/* --- Backdrop ------------------------------------------------------------- */

export type Backdrop = 'lavender' | 'sunflower' | 'peach' | 'mint' | 'sage' | 'sand' | 'slate'

/** The backdrop is the seat colour in the circle too, so these are the same
    lightness band: no one member's seat jumps forward. `from` is the lit corner
    of the gradient, `to` the far one. */
export const BACKDROPS: { id: Backdrop; label: string; from: string; to: string; seat: string }[] = [
  { id: 'lavender', label: 'Lavender', from: 'oklch(0.76 0.11 305)', to: 'oklch(0.62 0.13 262)', seat: 'oklch(0.68 0.12 280)' },
  { id: 'sunflower', label: 'Sunflower', from: 'oklch(0.88 0.13 92)', to: 'oklch(0.78 0.15 78)', seat: 'oklch(0.82 0.14 85)' },
  { id: 'peach', label: 'Peach', from: 'oklch(0.84 0.07 50)', to: 'oklch(0.74 0.09 40)', seat: 'oklch(0.78 0.08 45)' },
  { id: 'mint', label: 'Mint', from: 'oklch(0.9 0.08 165)', to: 'oklch(0.8 0.1 170)', seat: 'oklch(0.85 0.09 168)' },
  { id: 'sage', label: 'Sage', from: 'oklch(0.7 0.05 170)', to: 'oklch(0.56 0.05 180)', seat: 'oklch(0.63 0.05 175)' },
  { id: 'sand', label: 'Sand', from: 'oklch(0.88 0.06 85)', to: 'oklch(0.78 0.08 75)', seat: 'oklch(0.83 0.07 80)' },
  { id: 'slate', label: 'Slate', from: 'oklch(0.62 0.07 250)', to: 'oklch(0.48 0.08 258)', seat: 'oklch(0.55 0.08 254)' },
]

/* --- The look ------------------------------------------------------------- */

export type FacialHair = 'none' | 'stubble' | 'beard'

export type AvatarLook = {
  hair: HairStyle
  hairShade: HairShade
  skin: SkinTone
  outfit: Outfit
  backdrop: Backdrop
  facialHair: FacialHair
  glasses: boolean
  bindi: boolean
  earrings: boolean
  /** not offered in the builder — the children in the illustrative group */
  freckles?: boolean
}

/** What every member starts as, until they choose otherwise. Deliberately one
    look for everybody rather than one picked from the handle or the account:
    a default derived from anything about the member would be a fingerprint. */
export const DEFAULT_LOOK: AvatarLook = {
  hair: 'waves',
  hairShade: 'espresso',
  skin: 'honey',
  outfit: 'knit',
  backdrop: 'lavender',
  facialHair: 'none',
  glasses: false,
  bindi: false,
  earrings: false,
}

/** The illustrative members of the group. */
export type FaceKey = 'wren' | 'juniper' | 'marlow' | 'pip' | 'sable' | 'fennel' | 'corvo'

export const MEMBER_LOOKS: Record<FaceKey, AvatarLook> = {
  wren: DEFAULT_LOOK,
  juniper: {
    ...DEFAULT_LOOK,
    hair: 'bun',
    hairShade: 'silver',
    skin: 'tan',
    outfit: 'saree',
    backdrop: 'sage',
    glasses: true,
    bindi: true,
    earrings: true,
  },
  marlow: {
    ...DEFAULT_LOOK,
    hair: 'swept',
    hairShade: 'black',
    skin: 'tan',
    outfit: 'layered',
    backdrop: 'slate',
    facialHair: 'beard',
  },
  pip: {
    ...DEFAULT_LOOK,
    hair: 'tousled',
    hairShade: 'brown',
    skin: 'wheat',
    outfit: 'hoodie',
    backdrop: 'mint',
    glasses: true,
    freckles: true,
  },
  sable: {
    ...DEFAULT_LOOK,
    hair: 'scarf',
    hairShade: 'black',
    skin: 'brown',
    outfit: 'blazer',
    backdrop: 'peach',
  },
  fennel: {
    ...DEFAULT_LOOK,
    hair: 'curls',
    hairShade: 'chestnut',
    skin: 'wheat',
    outfit: 'cable',
    backdrop: 'sunflower',
    freckles: true,
  },
  corvo: {
    ...DEFAULT_LOOK,
    hair: 'swept',
    hairShade: 'grey',
    skin: 'honey',
    outfit: 'cardigan',
    backdrop: 'sand',
    facialHair: 'beard',
    glasses: true,
  },
}

/* --- Reading a stored look ------------------------------------------------ */

const ids = <T extends { id: string }>(xs: T[]) => new Set(xs.map((x) => x.id))
const HAIR_IDS = ids(HAIR_STYLES)
const SHADE_IDS = ids(HAIR_SHADES)
const SKIN_IDS = ids(SKIN_TONES)
const OUTFIT_IDS = ids(OUTFITS)
const BACKDROP_IDS = ids(BACKDROPS)
const FACIAL = new Set(['none', 'stubble', 'beard'])

/** A look read back from the server, made whole. Anything unknown — a key
    retired since it was saved, a field added since — falls back to the
    default for that one part rather than throwing the whole look away. */
export function readLook(raw: unknown): AvatarLook | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const pick = <T extends string>(v: unknown, ok: Set<string>, d: T): T =>
    typeof v === 'string' && ok.has(v) ? (v as T) : d
  return {
    hair: pick(r.hair, HAIR_IDS, DEFAULT_LOOK.hair),
    hairShade: pick(r.hairShade, SHADE_IDS, DEFAULT_LOOK.hairShade),
    skin: pick(r.skin, SKIN_IDS, DEFAULT_LOOK.skin),
    outfit: pick(r.outfit, OUTFIT_IDS, DEFAULT_LOOK.outfit),
    backdrop: pick(r.backdrop, BACKDROP_IDS, DEFAULT_LOOK.backdrop),
    facialHair: pick(r.facialHair, FACIAL, DEFAULT_LOOK.facialHair),
    glasses: r.glasses === true,
    bindi: r.bindi === true,
    earrings: r.earrings === true,
  }
}

/* --- Colour ---------------------------------------------------------------- */

const lch = ([l, c, h]: [number, number, number], dl = 0, dc = 0, dh = 0) =>
  `oklch(${Math.max(0, Math.min(1, l + dl)).toFixed(3)} ${Math.max(0, c + dc).toFixed(3)} ${(h + dh).toFixed(1)})`

/** Every colour a drawing needs, resolved from a look. */
export function paletteOf(look: AvatarLook) {
  const skin = (SKIN_TONES.find((s) => s.id === look.skin) ?? SKIN_TONES[2]).lch
  const hair = (HAIR_SHADES.find((s) => s.id === look.hairShade) ?? HAIR_SHADES[1]).lch
  const outfit = OUTFITS.find((o) => o.id === look.outfit) ?? OUTFITS[0]
  const backdrop = BACKDROPS.find((b) => b.id === look.backdrop) ?? BACKDROPS[0]
  /* Grey hair has almost no chroma, so its shadow has to come from lightness
     alone and needs the bigger step. */
  const grey = hair[1] < 0.02 && hair[0] > 0.5
  return {
    skin: lch(skin),
    skinLight: lch(skin, 0.06, -0.015, 5),
    skinShade: lch(skin, -0.08, 0.005, -5),
    skinDeep: lch(skin, -0.17, 0.0, -8),
    blush: lch([skin[0] - 0.03, skin[1] + 0.07, 25]),
    lip: lch([skin[0] - 0.16, skin[1] + 0.05, 22]),
    hair: lch(hair),
    hairLight: lch(hair, grey ? 0.1 : 0.13, grey ? 0 : 0.02, 4),
    hairShadow: lch(hair, grey ? -0.14 : -0.08),
    /* Brows stay darker than grey hair, as they do on people. */
    brow: grey ? lch(hair, -0.22) : lch(hair, -0.04),
    covering: COVERING_CLOTH,
    outfit,
    backdrop,
  }
}
