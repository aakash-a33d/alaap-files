/**
 * The member's avatar: which of the twelve group-session portraits they picked, and
 * any colours they laid over its hair, skin and outfit.
 *
 * Ids and colour keys only. The images live in the frontend (public/avatars/, listed in
 * features/groups/model/avatar.ts). This service stores which one was picked and
 * refuses any id it does not know. The list below must match that file. An id added
 * there and not here is refused on save, which is the safe direction to fail in.
 *
 * `.strict()` so a client cannot park arbitrary fields on the persona. Everything in
 * this object is shown to every member of a group, and a free-form field there would
 * be a channel nobody reviewed.
 */

import { z } from 'zod';

const GENDERS = ['woman', 'man'] as const;
const AGES = ['child', 'teen', '20s', '30s', 'middle', 'older'] as const;

export const PORTRAIT_IDS = GENDERS.flatMap((g) => AGES.map((a) => `${g}-${a}`)) as [
  string,
  ...string[],
];

/** Colours laid over the portrait. Each is optional: an absent part is drawn as
    the portrait has it. */
export const HAIR_COLOURS = ['black', 'espresso', 'brown', 'auburn', 'golden', 'grey', 'silver'] as const;
export const SKIN_TONES = ['fair', 'wheat', 'honey', 'tan', 'brown', 'deep'] as const;
export const OUTFIT_COLOURS = [
  'cream',
  'charcoal',
  'navy',
  'teal',
  'olive',
  'mustard',
  'maroon',
  'rose',
  'lavender',
] as const;

export const AvatarLook = z
  .object({
    portrait: z.enum(PORTRAIT_IDS),
    hair: z.enum(HAIR_COLOURS).optional(),
    skin: z.enum(SKIN_TONES).optional(),
    outfit: z.enum(OUTFIT_COLOURS).optional(),
  })
  .strict();

export type AvatarLook = z.infer<typeof AvatarLook>;
