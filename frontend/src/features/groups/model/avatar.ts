/* ============================================================================
   The portrait set — one stand-in per member.

   Twelve finished portraits: a woman and a man at each of six ages, from a
   child to an elder. Members pick one; they do not build one. A fixed set of
   finished portraits looks better than anything assembled from parts, and
   picking from twelve takes seconds.

   A choice is stored as the portrait's id, never as the image or a URL, so
   the files can be re-exported or replaced without rewriting anyone's
   profile. pseudonym-service validates the same id list
   (src/domain/avatar.ts). An id added here must be added there too.

   Nothing here is derived from the member: no photo, no camera frame, nothing
   from the identity vault. The portrait is only what they picked, and the
   default is the same for everybody.

   The therapist has no avatar. Nobody in the group is given a face by the
   platform except the members themselves, and a therapist who wears one
   starts to look like a peer.

   On top of the portrait, a member can change three colours: the hair, the
   skin and the outfit. The portrait itself never changes. Each one has three
   soft masks traced from it (model/layers/, built by
   scripts/avatars/build-layers.py), and a masked region is redrawn through a
   gradient map. That swaps the colour and keeps every bit of the original
   shading. The shape of the hair is the portrait's own; only its colour moves.

   The files live in public/avatars/ at 384px. Some of the originals carry a
   small mark in the bottom-right corner. Every place a portrait is shown masks
   it to a circle, which hides that corner. Keep the circle.
   ========================================================================= */

export type Gender = 'woman' | 'man'
export type AgeBand = 'child' | 'teen' | '20s' | '30s' | 'middle' | 'older'

export type PortraitId = `${Gender}-${AgeBand}`

export const GENDERS: { id: Gender; label: string }[] = [
  { id: 'woman', label: 'Women' },
  { id: 'man', label: 'Men' },
]

export const AGE_BANDS: { id: AgeBand; label: string }[] = [
  { id: 'child', label: 'Child' },
  { id: 'teen', label: 'Teen' },
  { id: '20s', label: 'In their 20s' },
  { id: '30s', label: 'In their 30s' },
  { id: 'middle', label: 'Middle age' },
  { id: 'older', label: 'Older' },
]

/** `seat` is the portrait's own backdrop colour, sampled from the image. It
    fills the seat behind the portrait and tints the builder, so the frame
    around a portrait matches the portrait itself. */
export type Portrait = { id: PortraitId; gender: Gender; age: AgeBand; src: string; seat: string }

const SEAT: Record<PortraitId, string> = {
  'woman-child': '#8de3bc',
  'woman-teen': '#e7ab1f',
  'woman-20s': '#ec9a7e',
  'woman-30s': '#8a8ad8',
  'woman-middle': '#8586d6',
  'woman-older': '#6b8978',
  'man-child': '#f3eee7',
  'man-teen': '#8443a8',
  'man-20s': '#8a88cc',
  'man-30s': '#8586d2',
  'man-middle': '#546f93',
  'man-older': '#d8af75',
}

export const PORTRAITS: Portrait[] = GENDERS.flatMap((g) =>
  AGE_BANDS.map((a) => {
    const id = `${g.id}-${a.id}` as PortraitId
    return { id, gender: g.id, age: a.id, src: `/avatars/${id}.webp`, seat: SEAT[id] }
  }),
)

const BY_ID = new Map(PORTRAITS.map((p) => [p.id, p]))

/* --- Colours laid over a portrait ---------------------------------------
   Each is a base colour in oklch. The renderer spreads it into a ramp from a
   shadow to a highlight and maps the region's own light and dark onto it.
   `original` is not in these lists: leaving a part unset draws it as painted. */

export type HairColour = 'black' | 'espresso' | 'brown' | 'auburn' | 'golden' | 'grey' | 'silver'
export type SkinTone = 'fair' | 'wheat' | 'honey' | 'tan' | 'brown' | 'deep'
export type OutfitColour =
  | 'cream'
  | 'charcoal'
  | 'navy'
  | 'teal'
  | 'olive'
  | 'mustard'
  | 'maroon'
  | 'rose'
  | 'lavender'

export type Swatch<T extends string> = { id: T; label: string; lch: [number, number, number] }

export const HAIR_COLOURS: Swatch<HairColour>[] = [
  { id: 'black', label: 'Black', lch: [0.22, 0.012, 50] },
  { id: 'espresso', label: 'Dark brown', lch: [0.3, 0.035, 45] },
  { id: 'brown', label: 'Brown', lch: [0.42, 0.06, 55] },
  { id: 'auburn', label: 'Auburn', lch: [0.45, 0.11, 38] },
  { id: 'golden', label: 'Golden', lch: [0.7, 0.1, 80] },
  { id: 'grey', label: 'Grey', lch: [0.62, 0.008, 70] },
  { id: 'silver', label: 'Silver', lch: [0.82, 0.006, 80] },
]

/** The range a room in India actually holds, lightest first. */
export const SKIN_TONES: Swatch<SkinTone>[] = [
  { id: 'fair', label: 'Fair', lch: [0.82, 0.06, 60] },
  { id: 'wheat', label: 'Wheatish', lch: [0.76, 0.07, 60] },
  { id: 'honey', label: 'Honey', lch: [0.69, 0.08, 57] },
  { id: 'tan', label: 'Tan', lch: [0.61, 0.08, 52] },
  { id: 'brown', label: 'Brown', lch: [0.52, 0.075, 46] },
  { id: 'deep', label: 'Deep', lch: [0.42, 0.06, 42] },
]

export const OUTFIT_COLOURS: Swatch<OutfitColour>[] = [
  { id: 'cream', label: 'Cream', lch: [0.92, 0.02, 85] },
  { id: 'charcoal', label: 'Charcoal', lch: [0.35, 0.01, 260] },
  { id: 'navy', label: 'Navy', lch: [0.38, 0.09, 262] },
  { id: 'teal', label: 'Teal', lch: [0.52, 0.08, 200] },
  { id: 'olive', label: 'Olive', lch: [0.5, 0.07, 125] },
  { id: 'mustard', label: 'Mustard', lch: [0.78, 0.14, 85] },
  { id: 'maroon', label: 'Maroon', lch: [0.42, 0.12, 20] },
  { id: 'rose', label: 'Rose', lch: [0.72, 0.09, 10] },
  { id: 'lavender', label: 'Lavender', lch: [0.72, 0.08, 300] },
]

export type AvatarLook = {
  portrait: PortraitId
  /** unset draws the part as painted */
  hair?: HairColour
  skin?: SkinTone
  outfit?: OutfitColour
}

/** What every member starts as, until they choose otherwise. Deliberately one
    portrait for everybody rather than one picked from the handle or the
    account: a default derived from anything about the member would be a
    fingerprint. */
export const DEFAULT_LOOK: AvatarLook = { portrait: 'woman-20s' }

export function portraitOf(look: AvatarLook): Portrait {
  return BY_ID.get(look.portrait) ?? BY_ID.get(DEFAULT_LOOK.portrait)!
}

/** A human description, for alt text and screen readers. */
export function describe(p: Portrait): string {
  const age = AGE_BANDS.find((a) => a.id === p.age)!.label.toLowerCase()
  const young = p.age === 'child' || p.age === 'teen'
  const who = p.gender === 'woman' ? (young ? 'girl' : 'woman') : young ? 'boy' : 'man'
  return young ? `${p.age === 'teen' ? 'teenage' : 'young'} ${who}` : `${who}, ${age}`
}

/** The illustrative members of the group. */
export type FaceKey = 'wren' | 'juniper' | 'marlow' | 'pip' | 'sable' | 'fennel' | 'corvo'

export const MEMBER_LOOKS: Record<FaceKey, AvatarLook> = {
  wren: DEFAULT_LOOK,
  juniper: { portrait: 'woman-older' },
  marlow: { portrait: 'man-30s' },
  pip: { portrait: 'man-child' },
  sable: { portrait: 'woman-middle' },
  fennel: { portrait: 'woman-teen' },
  corvo: { portrait: 'man-older' },
}

/** A look read back from the server. Anything that is not a known portrait
    (a retired id, or a look saved by the earlier drawn builder) is treated as
    no choice at all, and the member sees the default. A colour that is no
    longer offered falls back to the portrait as painted, for that part only. */
export function readLook(raw: unknown): AvatarLook | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.portrait !== 'string' || !BY_ID.has(r.portrait as PortraitId)) return undefined
  const pick = <T extends string>(v: unknown, list: Swatch<T>[]) =>
    list.find((s) => s.id === v)?.id
  const look: AvatarLook = { portrait: r.portrait as PortraitId }
  const hair = pick(r.hair, HAIR_COLOURS)
  const skin = pick(r.skin, SKIN_TONES)
  const outfit = pick(r.outfit, OUTFIT_COLOURS)
  if (hair) look.hair = hair
  if (skin) look.skin = skin
  if (outfit) look.outfit = outfit
  return look
}

/** CSS for a swatch dot. */
export const swatchCss = ([l, c, h]: [number, number, number]) =>
  `radial-gradient(circle at 36% 32%, oklch(${Math.min(l + 0.08, 0.98)} ${c} ${h}), oklch(${l} ${c} ${h}) 55%, oklch(${Math.max(l - 0.1, 0.05)} ${c} ${h}))`
