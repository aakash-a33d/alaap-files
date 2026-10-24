/**
 * Journals and mood check-ins. clinical_vault, clinical-vault-service's own tables.
 *
 * Every body in here is encrypted before it arrives and decrypted after it leaves —
 * this file never holds plaintext for longer than the call that asked for it, and the
 * database never holds it at all.
 *
 * The grants state the boundary from both sides: this service has no write on
 * `consent_records`, so it cannot grant itself permission to read what it stores; and
 * consent-service has no read on `journal_entries`, so the service that decides
 * permission cannot see the content it is deciding about.
 */

import { Pool } from 'pg';
import { open, seal, type TransitClient } from '@alaap/crypto-client';

export interface JournalEntry {
  id: string;
  body: string;
  entryDate: string;
  wordCount: number;
  privacyMode: string;
  createdAt: string;
}

/** A stored entry the platform cannot read. See `privacy_mode = 'maximum'`. */
export interface SealedEntry {
  id: string;
  entryDate: string;
  wordCount: number;
  privacyMode: 'maximum';
  createdAt: string;
  readable: false;
}

export interface MoodCheckin {
  id: string;
  moodScore: number;
  energyScore: number | undefined;
  sleepHours: number | undefined;
  stressScore: number | undefined;
  emotionTags: string[];
  entryDate: string;
}

/**
 * A pool that survives the database going away.
 *
 * `pg` re-emits an idle client's connection error on the Pool itself. An 'error' event
 * with no listener is not a logged warning in Node — it is an uncaught exception, and
 * the whole service exits mid-request. A Postgres restart terminates every idle
 * connection at once (57P01), so a routine restart takes down any service that happens
 * to be holding one, at random, with no log line of its own.
 *
 * Nothing needs to be repaired here. The pool discards the dead client and the next
 * query opens a fresh one; the only thing required is to not die while that happens.
 */
export function createClinicalPool(
  connectionString: string,
  log?: { error(o: object, m?: string): void },
): Pool {
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    application_name: 'alaap-clinical-vault-service',
  });
  pool.on('error', (err) => {
    log?.error({ err: err.message }, 'idle database client failed; pool will recover');
  });
  return pool;
}

export class RecordRepository {
  private readonly pool: Pool;
  private readonly transit: TransitClient;

  constructor(pool: Pool, transit: TransitClient) {
    this.pool = pool;
    this.transit = transit;
  }

  /**
   * Write a journal entry.
   *
   * The id is generated HERE rather than by the database, because it is the additional
   * authenticated data binding the ciphertext to its row — and it has to exist before
   * the sealing, not after the insert. Without that binding, somebody with write
   * access could move one member's entry onto another member's row and every integrity
   * check would still pass.
   *
   * `word_count` is stored in the clear on purpose. It is the one thing the interface
   * needs without decrypting, and a count is not content. The title is NOT here: a
   * title is content, and lives inside the ciphertext.
   */
  async writeJournal(params: {
    pseudoId: number;
    body: string;
    entryDate?: string | undefined;
  }): Promise<JournalEntry> {
    const id = crypto.randomUUID();
    const envelope = await seal(params.body, this.transit, id);

    const { rows } = await this.pool.query<{ entry_date: Date; created_at: Date }>(
      `INSERT INTO journal_entries
         (id, pseudo_id, body_ciphertext, body_dek, key_id, key_version,
          privacy_mode, entry_date, word_count)
       VALUES ($1, $2, $3, $4, $5, $6, 'standard', COALESCE($7::date, CURRENT_DATE), $8)
       RETURNING entry_date, created_at`,
      [
        id,
        params.pseudoId,
        envelope.ciphertext,
        envelope.wrappedDek,
        envelope.keyId,
        envelope.keyVersion,
        params.entryDate ?? null,
        params.body.trim().split(/\s+/).filter(Boolean).length,
      ],
    );

    const row = rows[0]!;
    return {
      id,
      body: params.body,
      entryDate: row.entry_date.toISOString().slice(0, 10),
      wordCount: params.body.trim().split(/\s+/).filter(Boolean).length,
      privacyMode: 'standard',
      createdAt: row.created_at.toISOString(),
    };
  }

  /**
   * Read one entry back, decrypting it.
   *
   * Scoped to the member in the WHERE clause. An entry id is a uuid and unguessable,
   * but "unguessable" is not an access control — the predicate is.
   *
   * A maximum-privacy entry comes back as metadata with `readable: false` rather than
   * as an error. The platform genuinely cannot open it, and saying so plainly is more
   * useful than a failure that looks like a bug.
   */
  async readJournal(
    pseudoId: number,
    id: string,
  ): Promise<JournalEntry | SealedEntry | undefined> {
    const { rows } = await this.pool.query<{
      body_ciphertext: Buffer;
      body_dek: Buffer;
      privacy_mode: string;
      entry_date: Date;
      word_count: number;
      created_at: Date;
    }>(
      `SELECT body_ciphertext, body_dek, privacy_mode, entry_date, word_count, created_at
         FROM journal_entries
        WHERE id = $1 AND pseudo_id = $2 AND deleted_at IS NULL`,
      [id, pseudoId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;

    const shared = {
      id,
      entryDate: row.entry_date.toISOString().slice(0, 10),
      wordCount: row.word_count,
      createdAt: row.created_at.toISOString(),
    };

    if (row.privacy_mode === 'maximum') {
      return { ...shared, privacyMode: 'maximum', readable: false };
    }

    const body = await open(
      { ciphertext: row.body_ciphertext, wrappedDek: row.body_dek },
      this.transit,
      id,
    );
    return { ...shared, body, privacyMode: row.privacy_mode };
  }

  /**
   * The member's entries, WITHOUT decrypting any of them.
   *
   * A list view needs dates and lengths, not content. Decrypting forty entries to
   * render a list would be forty KMS operations and forty chances for plaintext to
   * exist somewhere it did not need to.
   */
  async listJournal(pseudoId: number, limit: number): Promise<Omit<SealedEntry, 'readable' | 'privacyMode'> & { privacyMode: string }[]> {
    const { rows } = await this.pool.query<{
      id: string;
      entry_date: Date;
      word_count: number;
      privacy_mode: string;
      created_at: Date;
    }>(
      `SELECT id, entry_date, word_count, privacy_mode, created_at
         FROM journal_entries
        WHERE pseudo_id = $1 AND deleted_at IS NULL
        ORDER BY entry_date DESC, created_at DESC
        LIMIT $2`,
      [pseudoId, limit],
    );
    return rows.map((r) => ({
      id: r.id,
      entryDate: r.entry_date.toISOString().slice(0, 10),
      wordCount: r.word_count,
      privacyMode: r.privacy_mode,
      createdAt: r.created_at.toISOString(),
    })) as never;
  }

  /**
   * Delete an entry.
   *
   * Soft, and the ciphertext stays. That is deliberate and worth stating: a member
   * deleting one entry expects it gone from their journal, which this achieves; a
   * member deleting their ACCOUNT expects the bytes destroyed, which is
   * retention-service's job in M9 and is a different operation with different evidence
   * requirements. Conflating the two would make the second unprovable.
   */
  async deleteJournal(pseudoId: number, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE journal_entries SET deleted_at = now()
        WHERE id = $1 AND pseudo_id = $2 AND deleted_at IS NULL`,
      [id, pseudoId],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Record a mood check-in. One per member per day, replaced if it changes.
   *
   * NOT encrypted, and that is a considered decision rather than an oversight. A mood
   * score is a number from one to ten with no free text; encrypting it would cost a
   * KMS operation per read while protecting a value that the row's existence already
   * discloses as much as its content does. The plans metadata calls mood check-in free
   * for the same reason — "its cost is indistinguishable from zero".
   *
   * If a note field is ever added here, it is content and must be sealed.
   */
  async recordMood(params: {
    pseudoId: number;
    moodScore: number;
    energyScore?: number | undefined;
    sleepHours?: number | undefined;
    stressScore?: number | undefined;
    emotionTags?: string[] | undefined;
  }): Promise<MoodCheckin> {
    const { rows } = await this.pool.query<{
      id: string;
      mood_score: number;
      energy_score: number | null;
      sleep_hours: string | null;
      stress_score: number | null;
      emotion_tags: string[];
      entry_date: Date;
    }>(
      `INSERT INTO mood_checkins (pseudo_id, mood_score, energy_score, sleep_hours, stress_score, emotion_tags)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (pseudo_id, entry_date) DO UPDATE
         SET mood_score   = EXCLUDED.mood_score,
             energy_score = EXCLUDED.energy_score,
             sleep_hours  = EXCLUDED.sleep_hours,
             stress_score = EXCLUDED.stress_score,
             emotion_tags = EXCLUDED.emotion_tags,
             recorded_at  = now()
       RETURNING id, mood_score, energy_score, sleep_hours, stress_score, emotion_tags, entry_date`,
      [
        params.pseudoId,
        params.moodScore,
        params.energyScore ?? null,
        params.sleepHours ?? null,
        params.stressScore ?? null,
        params.emotionTags ?? [],
      ],
    );
    const row = rows[0]!;
    return {
      id: row.id,
      moodScore: row.mood_score,
      energyScore: row.energy_score ?? undefined,
      sleepHours: row.sleep_hours === null ? undefined : Number(row.sleep_hours),
      stressScore: row.stress_score ?? undefined,
      emotionTags: row.emotion_tags,
      entryDate: row.entry_date.toISOString().slice(0, 10),
    };
  }

  async moodHistory(pseudoId: number, days: number): Promise<MoodCheckin[]> {
    const { rows } = await this.pool.query<{
      id: string;
      mood_score: number;
      energy_score: number | null;
      sleep_hours: string | null;
      stress_score: number | null;
      emotion_tags: string[];
      entry_date: Date;
    }>(
      `SELECT id, mood_score, energy_score, sleep_hours, stress_score, emotion_tags, entry_date
         FROM mood_checkins
        WHERE pseudo_id = $1 AND entry_date > CURRENT_DATE - $2::integer
        ORDER BY entry_date DESC`,
      [pseudoId, days],
    );
    return rows.map((r) => ({
      id: r.id,
      moodScore: r.mood_score,
      energyScore: r.energy_score ?? undefined,
      sleepHours: r.sleep_hours === null ? undefined : Number(r.sleep_hours),
      stressScore: r.stress_score ?? undefined,
      emotionTags: r.emotion_tags,
      entryDate: r.entry_date.toISOString().slice(0, 10),
    }));
  }

  async countJournalSince(pseudoId: number, since: Date): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM journal_entries
        WHERE pseudo_id = $1 AND created_at >= $2 AND deleted_at IS NULL`,
      [pseudoId, since],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
