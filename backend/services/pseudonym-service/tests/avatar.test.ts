/**
 * The avatar look is the one thing on the persona a member writes themselves, and
 * every member of their group sees it. So the schema is the whole of the review: it
 * must take every look the builder can produce and refuse anything else.
 */

import { describe, expect, it } from 'vitest';

import { AvatarLook } from '../src/domain/avatar.ts';

const LOOK = {
  hair: 'bun',
  hairShade: 'silver',
  skin: 'tan',
  outfit: 'saree',
  backdrop: 'sage',
  facialHair: 'none',
  glasses: true,
  bindi: true,
  earrings: true,
};

describe('AvatarLook', () => {
  it('accepts a look the builder produces', () => {
    expect(AvatarLook.safeParse(LOOK).success).toBe(true);
  });

  it('refuses a key it does not know', () => {
    expect(AvatarLook.safeParse({ ...LOOK, outfit: 'tuxedo' }).success).toBe(false);
  });

  it('refuses a colour in place of a key', () => {
    expect(AvatarLook.safeParse({ ...LOOK, skin: 'oklch(0.7 0.06 58)' }).success).toBe(false);
  });

  it('refuses extra fields, so nothing free-form rides along to the group', () => {
    expect(AvatarLook.safeParse({ ...LOOK, note: 'hello' }).success).toBe(false);
  });

  it('refuses a partial look', () => {
    const { hair: _hair, ...rest } = LOOK;
    expect(AvatarLook.safeParse(rest).success).toBe(false);
  });
});
