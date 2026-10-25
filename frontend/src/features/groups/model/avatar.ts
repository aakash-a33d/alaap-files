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

   The files live in public/avatars/ at 512px. Some of the originals carry a
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

export type AvatarLook = { portrait: PortraitId }

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
    no choice at all, and the member sees the default. */
export function readLook(raw: unknown): AvatarLook | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const id = (raw as { portrait?: unknown }).portrait
  return typeof id === 'string' && BY_ID.has(id as PortraitId)
    ? { portrait: id as PortraitId }
    : undefined
}
