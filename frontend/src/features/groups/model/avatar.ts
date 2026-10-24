/* ============================================================================
   The flat character set — one stand-in per member.

   Every avatar is the same drawing with parts swapped: a head, a hair shape in
   two pieces (behind and in front of the face), an optional beard, an optional
   accessory. That constraint is the point. Seven people in a circle have to be
   told apart at 54px and still read as one group rather than seven clip-art
   styles, so the silhouette is shared and only colour and hair change.

   Colours are kept in oklch because the set was picked as one ramp — the seven
   member hues are the same lightness and chroma at seven angles, which is what
   keeps any one of them from jumping forward in the circle. Converting them to
   hex would lose the relationship and invite someone to nudge one.

   The therapist has no avatar. Nobody in the group is given a drawn face by
   the platform except the members themselves, and a therapist who wears one
   starts to look like a peer.
   ========================================================================= */

export type HairStyle = 'long' | 'bun' | 'buzz' | 'curls' | 'wavy' | 'scarf' | 'crop'

/** Hair is two paths: the mass behind the head, and the fringe over it. Drawn
    either side of the face ellipse so a fringe can overlap the forehead. */
export const HAIR: Record<HairStyle, { back: string; front: string }> = {
  long: {
    back: 'M27 70 C25 40 34 21 50 21 C66 21 75 40 73 70 L64 70 C67 47 61 39 50 39 C39 39 33 47 36 70 Z',
    front: 'M31 41 C32 26 40 20 50 20 C61 20 69 27 69 40 C63 31 53 35 45 35 C39 35 34 37 31 41 Z',
  },
  bun: {
    back: 'M31 45 C31 25 40 19 50 19 C60 19 69 25 69 45 C69 33 61 29 50 29 C39 29 31 33 31 45 Z M42 14 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0',
    front: 'M32 40 C33 27 41 22 50 22 C60 22 68 28 68 40 C68 32 60 30 50 30 C40 30 32 32 32 40 Z',
  },
  buzz: {
    back: 'M33 43 C33 28 41 23 50 23 C59 23 67 28 67 43 C67 35 60 32 50 32 C40 32 33 35 33 43 Z',
    front: 'M34 39 C35 29 42 25 50 25 C58 25 66 29 66 39 C66 33 59 31 50 31 C41 31 34 33 34 39 Z',
  },
  curls: {
    back: 'M30 46 C30 24 40 18 50 18 C60 18 70 24 70 46 C70 34 61 30 50 30 C39 30 30 34 30 46 Z M28 34 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0 M58 34 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0 M40 22 a7.5 7.5 0 1 0 15 0 a7.5 7.5 0 1 0 -15 0',
    front: 'M33 39 C34 28 41 23 50 23 C59 23 67 28 67 39 C63 32 56 34 48 34 C42 34 36 36 33 39 Z',
  },
  wavy: {
    back: 'M28 62 C26 38 35 21 50 21 C65 21 74 38 72 62 C69 55 68 46 62 44 C66 40 60 37 50 37 C40 37 34 40 38 44 C32 46 31 55 28 62 Z',
    front: 'M31 42 C32 26 41 20 50 20 C60 20 68 27 68 39 C61 30 50 36 42 36 C37 36 33 39 31 42 Z',
  },
  scarf: {
    back: 'M28 52 C28 24 39 18 50 18 C61 18 72 24 72 52 C72 62 64 66 50 66 C36 66 28 62 28 52 Z',
    front: 'M30 44 C31 25 40 20 50 20 C60 20 70 25 71 44 C66 34 58 32 50 32 C42 32 34 34 30 44 Z',
  },
  crop: {
    back: 'M32 44 C32 26 40 20 50 20 C60 20 68 26 68 44 C68 33 60 29 50 29 C40 29 32 33 32 44 Z',
    front: 'M32 41 C33 26 41 21 50 21 C61 21 69 26 69 38 C64 30 55 33 46 33 C40 33 35 37 32 41 Z',
  },
}

/** One accessory, drawn as a stroke over the face. */
export const GLASSES =
  'M40 45 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M50 45 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M49.5 44 h1 M35 44 l4 0 M65 44 l-4 0'

export const BEARD =
  'M32.5 44 C32.5 62 41 69 50 69 C59 69 67.5 62 67.5 44 C67.5 56 60 61 50 61 C40 61 32.5 56 32.5 44 Z'

export type FaceKey = 'wren' | 'juniper' | 'marlow' | 'pip' | 'sable' | 'fennel' | 'corvo'

export type Face = {
  /** the tile behind the character, and the seat colour in the circle */
  bg: string
  skin: string
  /** ears and the neck, one step down from the face */
  skinShade: string
  hair: string
  /** the shoulders */
  top: string
  /** eyes, mouth, and any accessory */
  ink: string
  style: HairStyle
  glasses?: boolean
  beard?: boolean
}

export const FACES: Record<FaceKey, Face> = {
  wren: {
    bg: 'oklch(0.90 0.035 105)',
    skin: 'oklch(0.81 0.055 62)',
    skinShade: 'oklch(0.74 0.055 58)',
    hair: 'oklch(0.42 0.055 50)',
    top: 'oklch(0.70 0.085 105)',
    ink: 'oklch(0.32 0.03 50)',
    style: 'long',
  },
  juniper: {
    bg: 'oklch(0.90 0.035 150)',
    skin: 'oklch(0.72 0.065 52)',
    skinShade: 'oklch(0.65 0.06 48)',
    hair: 'oklch(0.28 0.03 40)',
    top: 'oklch(0.70 0.085 150)',
    ink: 'oklch(0.28 0.025 45)',
    style: 'bun',
  },
  marlow: {
    bg: 'oklch(0.90 0.035 205)',
    skin: 'oklch(0.60 0.065 45)',
    skinShade: 'oklch(0.53 0.06 42)',
    hair: 'oklch(0.24 0.02 40)',
    top: 'oklch(0.70 0.085 200)',
    ink: 'oklch(0.22 0.02 40)',
    style: 'buzz',
  },
  pip: {
    bg: 'oklch(0.90 0.035 250)',
    skin: 'oklch(0.85 0.05 72)',
    skinShade: 'oklch(0.78 0.05 68)',
    hair: 'oklch(0.64 0.10 68)',
    top: 'oklch(0.70 0.085 250)',
    ink: 'oklch(0.32 0.03 50)',
    style: 'curls',
    glasses: true,
  },
  sable: {
    bg: 'oklch(0.90 0.035 300)',
    skin: 'oklch(0.56 0.06 42)',
    skinShade: 'oklch(0.49 0.055 40)',
    hair: 'oklch(0.52 0.09 300)',
    top: 'oklch(0.70 0.085 300)',
    ink: 'oklch(0.22 0.02 40)',
    style: 'scarf',
  },
  fennel: {
    bg: 'oklch(0.90 0.035 340)',
    skin: 'oklch(0.79 0.055 58)',
    skinShade: 'oklch(0.72 0.05 55)',
    hair: 'oklch(0.52 0.10 42)',
    top: 'oklch(0.70 0.085 340)',
    ink: 'oklch(0.32 0.03 50)',
    style: 'wavy',
  },
  corvo: {
    bg: 'oklch(0.90 0.035 68)',
    skin: 'oklch(0.68 0.06 48)',
    skinShade: 'oklch(0.61 0.055 45)',
    hair: 'oklch(0.34 0.04 45)',
    top: 'oklch(0.70 0.085 65)',
    ink: 'oklch(0.26 0.025 42)',
    style: 'crop',
    beard: true,
  },
}

/** The six skin tones offered in the builder, each with the shade used for
    ears and neck. Kept as pairs rather than derived, because the step between
    a face and its own shadow is picked by eye at each end of the ramp and a
    single formula gets the darkest two wrong. */
export const SKIN_TONES: { skin: string; skinShade: string }[] = [
  { skin: 'oklch(0.90 0.03 65)', skinShade: 'oklch(0.83 0.035 62)' },
  { skin: 'oklch(0.82 0.05 62)', skinShade: 'oklch(0.75 0.05 58)' },
  { skin: 'oklch(0.70 0.06 58)', skinShade: 'oklch(0.63 0.055 55)' },
  { skin: 'oklch(0.56 0.06 52)', skinShade: 'oklch(0.49 0.055 50)' },
  { skin: 'oklch(0.42 0.05 48)', skinShade: 'oklch(0.36 0.045 46)' },
  { skin: 'oklch(0.32 0.04 44)', skinShade: 'oklch(0.27 0.035 42)' },
]

/** The six circle colours: the shoulders, and the tile behind them. Same hue,
    two lightnesses — which is what keeps the character legible against its
    own background at 54px. */
export const CIRCLE_COLOURS: { top: string; bg: string }[] = [
  { top: 'oklch(0.70 0.085 105)', bg: 'oklch(0.90 0.035 105)' },
  { top: 'oklch(0.70 0.085 150)', bg: 'oklch(0.90 0.035 150)' },
  { top: 'oklch(0.70 0.085 200)', bg: 'oklch(0.90 0.035 205)' },
  { top: 'oklch(0.70 0.085 250)', bg: 'oklch(0.90 0.035 250)' },
  { top: 'oklch(0.70 0.085 300)', bg: 'oklch(0.90 0.035 300)' },
  { top: 'oklch(0.70 0.085 340)', bg: 'oklch(0.90 0.035 340)' },
]

/** Every hair shape, in the order the builder offers them. */
export const HAIR_STYLES: HairStyle[] = ['long', 'bun', 'curls', 'wavy', 'scarf', 'crop', 'buzz']

/** A base character with parts swapped over it. `tweak` is how the builder
    works: it hands over the one part being changed and everything else stays
    as it was, which is the only way a preview can honestly show what a single
    choice does. */
export function resolveFace(face: FaceKey, tweak?: Partial<Face>): Face {
  return tweak ? { ...FACES[face], ...tweak } : FACES[face]
}

/** The four paths a drawing needs, resolved from a face. */
export function partsOf(face: Face) {
  const hair = HAIR[face.style]
  return {
    hairBack: hair.back,
    hairFront: hair.front,
    beard: face.beard ? BEARD : '',
    accessory: face.glasses ? GLASSES : '',
  }
}
