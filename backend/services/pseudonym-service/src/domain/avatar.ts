/**
 * The member's avatar look — what they chose to be drawn as in group sessions.
 *
 * Keys only. The drawing, and every colour each key stands for, live in the frontend
 * (features/groups/model/avatar.ts); this service stores which keys were picked and
 * refuses any it does not know. The lists below must match that file — a key added
 * there and not here is refused on save, which is the safe direction to fail in.
 *
 * `.strict()` so a client cannot park arbitrary fields on the persona: everything in
 * this object is shown to every member of a group, and a free-form field there would
 * be a channel nobody reviewed.
 */

import { z } from 'zod';

export const AvatarLook = z
  .object({
    hair: z.enum(['waves', 'curls', 'bob', 'bun', 'swept', 'tousled', 'crop', 'turban', 'scarf']),
    hairShade: z.enum(['black', 'espresso', 'brown', 'chestnut', 'grey', 'silver']),
    skin: z.enum(['fair', 'wheat', 'honey', 'tan', 'brown', 'deep']),
    outfit: z.enum([
      'knit',
      'cardigan',
      'blazer',
      'saree',
      'kurta',
      'hoodie',
      'denim',
      'overshirt',
      'layered',
      'cable',
    ]),
    backdrop: z.enum(['lavender', 'sunflower', 'peach', 'mint', 'sage', 'sand', 'slate']),
    facialHair: z.enum(['none', 'stubble', 'beard']),
    glasses: z.boolean(),
    bindi: z.boolean(),
    earrings: z.boolean(),
  })
  .strict();

export type AvatarLook = z.infer<typeof AvatarLook>;
