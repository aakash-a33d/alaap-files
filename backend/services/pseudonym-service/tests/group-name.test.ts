/**
 * A member's name in a group is free text that seven other people will see for a whole
 * cycle. The schema is what keeps it a name: any script a name is written in, and
 * nothing that would let somebody be found outside the group.
 */

import { describe, expect, it } from 'vitest';

import { GroupId, GroupName, SetGroupNameBody } from '../src/domain/group-name.ts';

const ok = (s: string) => GroupName.safeParse(s);

describe('GroupName', () => {
  it('accepts chosen names and real first names', () => {
    for (const name of ['Wren', 'Asha', "D'Souza", 'Mary-Ann', 'Jo B.', 'Ana Lucía']) {
      expect(ok(name).success, name).toBe(true);
    }
  });

  it('accepts names written in Indian scripts', () => {
    for (const name of ['आशा', 'ਗੁਰਪ੍ਰੀਤ', 'அனு', 'প্রিয়া']) {
      expect(ok(name).success, name).toBe(true);
    }
  });

  it('tidies whitespace before checking', () => {
    const r = ok('   Asha    Rao  ');
    expect(r.success && r.data).toBe('Asha Rao');
  });

  it('refuses anything that could reach the member outside the group', () => {
    for (const name of ['9000000001', 'asha@example.com', 'SepiaPeepal-9767', 'insta_asha']) {
      expect(ok(name).success, name).toBe(false);
    }
  });

  it('refuses empty, blank and over-long names', () => {
    expect(ok('').success).toBe(false);
    expect(ok('    ').success).toBe(false);
    expect(ok('A'.repeat(25)).success).toBe(false);
    expect(ok('A'.repeat(24)).success).toBe(true);
  });

  it('refuses a name that starts or ends with punctuation', () => {
    expect(ok('-Asha').success).toBe(false);
    expect(ok("Asha'").success).toBe(false);
  });

  it('refuses extra fields in the request', () => {
    expect(SetGroupNameBody.safeParse({ name: 'Asha', groupId: 'x' }).success).toBe(false);
  });
});

describe('GroupId', () => {
  it('takes a lower-case slug and nothing else', () => {
    expect(GroupId.safeParse('health-anxiety-2026-c3').success).toBe(true);
    expect(GroupId.safeParse('Health Anxiety').success).toBe(false);
    expect(GroupId.safeParse('../etc').success).toBe(false);
  });
});
