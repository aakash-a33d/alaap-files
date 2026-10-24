/**
 * The context sanitiser and the action-type derivation.
 *
 * The sanitiser is the function standing between a careless caller and a permanent
 * leak into the one store that is never deleted, so it gets its own assertions rather
 * than being covered incidentally by something else.
 */

import { describe, expect, it } from 'vitest';

import { CONTEXT_ALLOWLIST, gatewayActionType, sanitiseContext } from '../src/index.ts';

describe('context sanitiser', () => {
  it('keeps allowlisted scalars', () => {
    const { context, dropped } = sanitiseContext({
      api_group: '/api/community',
      method: 'POST',
      record_count: 3,
      step_up_required: false,
    });
    expect(context).toEqual({
      api_group: '/api/community',
      method: 'POST',
      record_count: 3,
      step_up_required: false,
    });
    expect(dropped).toEqual([]);
  });

  it('drops anything not on the allowlist', () => {
    const { context, dropped } = sanitiseContext({
      api_group: '/api/journal',
      body: 'the actual journal text',
      legal_name: 'a real person',
    });
    expect(context).toEqual({ api_group: '/api/journal' });
    expect(dropped).toEqual(['body', 'legal_name']);
  });

  it('drops non-scalars even when the key is allowlisted', () => {
    // A nested object is how content smuggles itself past a key check.
    const { context, dropped } = sanitiseContext({
      record_kind: { nested: 'journal text hiding in an object' },
      vault: ['clinical', 'and an array'],
    });
    expect(context).toEqual({});
    expect(dropped).toEqual(['record_kind', 'vault']);
  });

  it('returns an empty object for no context', () => {
    expect(sanitiseContext(undefined)).toEqual({ context: {}, dropped: [] });
  });

  it('allowlists no key that names content or identity', () => {
    // A guard on the allowlist itself. If someone adds one of these later, this
    // fails rather than the leak being discovered in an audit export.
    const forbidden = [
      'body', 'content', 'text', 'transcript', 'journal', 'message',
      'legal_name', 'name', 'mobile', 'phone', 'email', 'address',
      'government_id', 'aadhaar', 'emergency_contact', 'token', 'password', 'key',
    ];
    for (const key of forbidden) {
      expect(CONTEXT_ALLOWLIST.has(key), `"${key}" must never be allowlisted`).toBe(false);
    }
  });
});

describe('gateway action type', () => {
  it('derives domain and verb', () => {
    expect(gatewayActionType('/api/community', 'POST')).toBe('gateway.community.create');
    expect(gatewayActionType('/api/community', 'GET')).toBe('gateway.community.read');
    expect(gatewayActionType('/api/data-rights', 'DELETE')).toBe('gateway.data_rights.delete');
    expect(gatewayActionType('/api/break-glass', 'PATCH')).toBe('gateway.break_glass.update');
  });

  it('falls back to `other` for an unmapped method', () => {
    expect(gatewayActionType('/api/community', 'OPTIONS')).toBe('gateway.community.other');
  });

  it('is case-insensitive on the method', () => {
    expect(gatewayActionType('/api/community', 'post')).toBe('gateway.community.create');
  });
});
