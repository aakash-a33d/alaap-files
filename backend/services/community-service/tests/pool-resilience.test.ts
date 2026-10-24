/**
 * A database restart must not kill the service.
 *
 * This is a regression test for an outage, not a hypothetical. community-service exited
 * with code 1 twice in ten minutes while idle, both times on:
 *
 *   throw er; // Unhandled 'error' event
 *   error: terminating connection due to administrator command   code: '57P01'
 *       at Client.idleListener (pg-pool/index.js:62:10)
 *
 * `pg` re-emits an idle client's error on the Pool. In Node an 'error' event with no
 * listener is an uncaught exception rather than a logged warning, so a routine Postgres
 * restart — which terminates every idle connection at once — takes down whichever
 * services happen to be holding one. Which ones those are is a matter of timing, which
 * is why six services survived the same restart that killed the seventh.
 *
 * Constructing a Pool opens no connection, so none of this needs a live database.
 */

import { describe, expect, it, vi } from 'vitest';

import { createCommunityPool } from '../src/infrastructure/posts.ts';

const URL = 'postgres://nobody:nothing@127.0.0.1:1/never_connected';

describe('the pool survives the database going away', () => {
  it('listens for idle client errors', async () => {
    const pool = createCommunityPool(URL);
    expect(pool.listenerCount('error')).toBeGreaterThan(0);
    await pool.end();
  });

  it('does not rethrow when one arrives', () => {
    // The assertion is that this line does not take the test runner down with it.
    const log = { error: vi.fn() };
    const pool = createCommunityPool(URL, log);

    expect(() => pool.emit('error', new Error('terminating connection due to administrator command')))
      .not.toThrow();
    expect(log.error).toHaveBeenCalledOnce();
  });

  it('reports what happened, so an outage is not silent', () => {
    const log = { error: vi.fn() };
    const pool = createCommunityPool(URL, log);
    pool.emit('error', new Error('57P01'));

    expect(log.error.mock.calls[0]![0]).toMatchObject({ err: '57P01' });
  });

  it('survives a logger not being passed at all', () => {
    // The optional parameter must not become the new way to crash.
    const pool = createCommunityPool(URL);
    expect(() => pool.emit('error', new Error('boom'))).not.toThrow();
  });
});
