/**
 * The name a member goes by inside one therapy group.
 *
 * Free text, because a member may use their real first name or one they make up, and
 * the platform has no business telling the two apart. What it does refuse is anything
 * that is not a name: digits and @ are what a phone number, an email or another
 * service's username would need, and a name that carries one of those is a way to be
 * found outside the group. Letters in any script are allowed, with the spaces,
 * hyphens, apostrophes and full stops real names use.
 *
 * Whitespace is tidied before the length check, so "  Asha  " and "Asha" are the same
 * name and a name cannot be padded to look different from someone else's.
 */

import { z } from 'zod';

export const GROUP_NAME_MAX = 24;

const NAME = /^[\p{L}\p{M}](?:[\p{L}\p{M} '.-]*[\p{L}\p{M}.])?$/u;

export const GroupName = z
  .string()
  .transform((s) => s.normalize('NFC').trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(1)
      .max(GROUP_NAME_MAX)
      .regex(NAME),
  );

export const GroupId = z.string().regex(/^[a-z0-9-]{3,64}$/);

export const SetGroupNameBody = z.object({ name: GroupName }).strict();
