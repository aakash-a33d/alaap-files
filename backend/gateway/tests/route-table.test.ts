import { describe, expect, it } from 'vitest';

import { loadMetadata } from '../src/config/metadata.ts';
import { fullPath, RouteTable } from '../src/routes/table.ts';

const metadata = loadMetadata();
const table = new RouteTable(metadata.groups);

describe('route resolution', () => {
  it('resolves a path to its group', () => {
    expect(table.resolve('/api/community/posts')?.service).toBe('community-service');
    expect(table.resolve('/api/journal/3912')?.service).toBe('clinical-vault-service');
  });

  it('prefers the longest prefix', () => {
    // /api/moderator must not be swallowed by /api/moderation, and the two go to
    // the same service with very different role sets and audit levels.
    expect(table.resolve('/api/moderator/queue')?.roles).toEqual(['moderator', 'admin']);
    expect(table.resolve('/api/moderation/appeals')?.roles).toEqual(['user']);
  });

  it('does not match a prefix that is only a string prefix', () => {
    // /api/plansomething is not inside /api/plans.
    expect(table.resolve('/api/plansomething')).toBeUndefined();
  });

  it('refuses an unknown path rather than defaulting', () => {
    expect(table.resolve('/api/identity-vault')).toBeUndefined();
    expect(table.resolve('/api/audit')).toBeUndefined();
    expect(table.resolve('/api/../etc/passwd')).toBeUndefined();
  });
});

describe('mount-relative paths', () => {
  // Regression: the middleware is mounted at '/api', so Express hands it
  // req.path === '/community/feed' with req.baseUrl === '/api'. Matching on req.path
  // alone 404s every single route. RouteTable was correct throughout; the wiring
  // was not, which is why only an end-to-end request surfaced it.
  it('rejoins baseUrl so a mounted router still resolves', () => {
    expect(fullPath({ baseUrl: '/api', path: '/community/feed' })).toBe('/api/community/feed');
    expect(table.resolve(fullPath({ baseUrl: '/api', path: '/community/feed' })))
      .toBeDefined();
  });

  it('is correct when mounted at the root', () => {
    expect(fullPath({ baseUrl: '', path: '/api/community/feed' })).toBe('/api/community/feed');
  });

  it('never yields an empty string', () => {
    expect(fullPath({ baseUrl: '', path: '' })).toBe('/');
  });
});
