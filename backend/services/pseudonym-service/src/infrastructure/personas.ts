/**
 * Persona repository. community_vault, pseudonym-service's own tables.
 *
 * This service holds credentials to personas and block lists — and to NOTHING else in
 * the vault. It cannot read a post body, which is what stops it from linking a persona
 * to what that persona said. The grant enforces it; this file simply has no query that
 * would try.
 *
 * The handle is PERMANENT and always DRAWN: one per persona, therefore one per
 * verified mobile number, and never supplied by the member. See
 * community-vault/0002_permanent_handles.sql for what permanence trades away, and the
 * header of metadata/pseudonyms/handle-words.v1.yaml for why nobody picks their own.
 */

import { Pool } from 'pg';

import {
  avatarSeedFor,
  generateHandle,
  normaliseHandle,
  type HandlePolicy,
} from '../domain/handle.ts';

export interface Persona {
  pseudoId: number;
  handle: string;
  avatarSeed: string;
  avatarStyle: string;
  status: string;
  createdAt: string;
}

interface Row {
  pseudo_id: string;
  handle: string;
  avatar_seed: string;
  avatar_style: string;
  status: string;
  created_at: Date;
}

function toPersona(row: Row): Persona {
  return {
    pseudoId: Number(row.pseudo_id),
    handle: row.handle,
    avatarSeed: row.avatar_seed,
    avatarStyle: row.avatar_style,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

const COLUMNS = `pseudo_id, handle, avatar_seed, avatar_style, status, created_at`;
const SELECT = `SELECT ${COLUMNS} FROM pseudo_profiles`;

export interface CreateResult {
  persona: Persona;
  /** False when an earlier call already created it — see the idempotency note below. */
  created: boolean;
}

export class PersonaRepository {
  private readonly pool: Pool;
  private readonly policy: HandlePolicy;

  constructor(
    connectionString: string,
    policy: HandlePolicy,
    log?: { error(o: object, m?: string): void },
  ) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 5_000,
      application_name: 'alaap-pseudonym-service',
    });
    // An 'error' event with no listener is an uncaught exception, not a warning: a
    // Postgres restart terminates every idle connection (57P01) and takes the service
    // down with it. The pool repairs itself; this only has to keep the process alive.
    this.pool.on('error', (err) => {
      log?.error({ err: err.message }, 'idle database client failed; pool will recover');
    });
    this.policy = policy;
  }

  /**
   * Create a persona for a pseudo_id that auth-service has already allocated.
   *
   * Idempotent on pseudo_id: registration is a multi-step flow over an unreliable
   * mobile network, and a retried final step must not fail or create a second
   * persona. Returns the existing one instead — which, now that handles are
   * permanent, also guarantees a retry never changes somebody's handle.
   *
   * `created` distinguishes the two outcomes so the caller does not write a second
   * `pseudonym.persona.created` audit event for a retry. An audit trail that records
   * two creations for one persona is an audit trail saying something untrue.
   *
   * The handle is retried on collision rather than pre-checked, because a
   * check-then-insert race would produce exactly the duplicate the unique constraint
   * exists to prevent.
   */
  async create(pseudoId: number): Promise<CreateResult> {
    const existing = await this.find(pseudoId);
    if (existing !== undefined) return { persona: existing, created: false };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const handle = generateHandle(this.policy);
      try {
        const { rows } = await this.pool.query<Row>(
          `INSERT INTO pseudo_profiles
             (pseudo_id, handle, handle_normalised, avatar_seed, avatar_style)
           VALUES ($1, $2, $3, $4, 'identicon')
           RETURNING ${COLUMNS}`,
          [pseudoId, handle, normaliseHandle(handle, this.policy), avatarSeedFor(handle)],
        );
        return { persona: toPersona(rows[0]!), created: true };
      } catch (err) {
        const code = (err as { code?: string }).code;
        const constraint = (err as { constraint?: string }).constraint ?? '';
        // A handle collision is retryable. A duplicate pseudo_id means a concurrent
        // create won the race, so return whatever it wrote rather than failing.
        if (code === '23505' && constraint.includes('pkey')) {
          const winner = await this.find(pseudoId);
          if (winner !== undefined) return { persona: winner, created: false };
        }
        if (code === '23505' && attempt < 9) continue;
        throw err;
      }
    }
    throw new Error('could not allocate a unique handle after 10 attempts');
  }

  async find(pseudoId: number): Promise<Persona | undefined> {
    const { rows } = await this.pool.query<Row>(`${SELECT} WHERE pseudo_id = $1`, [pseudoId]);
    const row = rows[0];
    return row === undefined ? undefined : toPersona(row);
  }

  /**
   * Resolve a handle to a persona, for login.
   *
   * Matched on the normalised form, so somebody recovering an account gets in whether
   * they typed `SlowTide-2093`, `slowtide2093` or `SlowTide-2O93` — which is what a
   * person copying a handle off paper, having lost their phone, actually produces.
   *
   * This is not an enumeration risk worth defending: a handle appears on every post
   * its owner writes, so whether one exists is already public. What must NOT leak
   * from here is whether that persona has an account in a usable state — which is why
   * the caller answers identically for a hit and a miss.
   */
  async findByHandle(handle: string): Promise<Persona | undefined> {
    const { rows } = await this.pool.query<Row>(`${SELECT} WHERE handle_normalised = $1`, [
      normaliseHandle(handle, this.policy),
    ]);
    const row = rows[0];
    return row === undefined ? undefined : toPersona(row);
  }

  /** The handle, and when it was issued. It is the whole of the public identity. */
  async exportFor(pseudoId: number): Promise<{ handle: string; createdAt: string } | undefined> {
    const { rows } = await this.pool.query<{ handle: string; created_at: Date }>(
      `SELECT handle, created_at FROM pseudo_profiles WHERE pseudo_id = $1`,
      [pseudoId],
    );
    const row = rows[0];
    return row === undefined
      ? undefined
      : { handle: row.handle, createdAt: row.created_at.toISOString() };
  }

  /**
   * Retire the handle.
   *
   * This is the row that makes a pseudonym resolvable to anything at all. Once it is
   * gone, the pseudo id left behind in the audit vault points at nobody — which is what
   * makes keeping that trail survivable for the member, and is the reason this purge
   * runs last of all.
   *
   * The handle is NOT returned to the pool for reuse. Reissuing "QuietRiver-4821" to
   * somebody else would attach a stranger to whatever the first person had said under
   * it, in anybody's memory or screenshot. The space is 360 million; it can afford to
   * lose one.
   */
  async purge(pseudoId: number): Promise<{ purged: number; held: number; detail: string[] }> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM pseudo_profiles WHERE pseudo_id = $1`,
      [pseudoId],
    );
    return { purged: rowCount ?? 0, held: 0, detail: [] };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
