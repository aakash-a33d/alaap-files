/**
 * The avatar is the one thing on the persona a member writes themselves, and every
 * member of their group sees it. So the schema is the whole of the review: it must
 * take each of the twelve portraits and refuse anything else.
 */

import { describe, expect, it } from 'vitest';

import { AvatarLook, PORTRAIT_IDS } from '../src/domain/avatar.ts';

describe('AvatarLook', () => {
  it('knows twelve portraits, a woman and a man at six ages', () => {
    expect(PORTRAIT_IDS).toHaveLength(12);
    expect(PORTRAIT_IDS).toContain('woman-older');
    expect(PORTRAIT_IDS).toContain('man-child');
  });

  it('accepts every portrait', () => {
    for (const portrait of PORTRAIT_IDS) {
      expect(AvatarLook.safeParse({ portrait }).success).toBe(true);
    }
  });

  it('refuses an id it does not know', () => {
    expect(AvatarLook.safeParse({ portrait: 'woman-40s' }).success).toBe(false);
  });

  it('refuses a URL in place of an id', () => {
    expect(AvatarLook.safeParse({ portrait: 'https://example.com/me.png' }).success).toBe(false);
  });

  it('refuses extra fields, so nothing free-form rides along to the group', () => {
    expect(AvatarLook.safeParse({ portrait: 'man-30s', note: 'hello' }).success).toBe(false);
  });

  it('refuses a look saved by the earlier drawn builder', () => {
    expect(AvatarLook.safeParse({ hair: 'bun', skin: 'tan', outfit: 'saree' }).success).toBe(false);
  });
});
