/**
 * The member's avatar: which of the twelve group-session portraits they picked.
 *
 * An id only. The images live in the frontend (public/avatars/, listed in
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

export const AvatarLook = z.object({ portrait: z.enum(PORTRAIT_IDS) }).strict();

export type AvatarLook = z.infer<typeof AvatarLook>;
