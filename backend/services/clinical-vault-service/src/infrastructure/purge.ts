/**
 * Removing a member from the clinical vault, and handing back what they wrote.
 *
 * THE ENCRYPTION NEEDS NO SEPARATE STEP.
 *
 * Each journal entry's data key is wrapped and stored in the same row as its
 * ciphertext. Delete the row and the key goes with it, which leaves the ciphertext
 * unrecoverable by anyone, including us. There is nothing to crypto-shred afterwards:
 * the Transit key is per vault rather than per member, and destroying it would destroy
 * every member's entries to remove one member's.
 *
 * NO LEGAL HOLD HERE, DELIBERATELY.
 *
 * A journal is private. Nobody is appealing it, nobody reported it, and no
 * investigation touches it — the platform holds no ground on which to retain one
 * against its author's wishes. The community vault has holds because replies are aimed
 * at other people; this vault has none.
 */

import type { Pool } from 'pg';
import { open, type TransitClient } from '@alaap/crypto-client';

export interface ClinicalExport {
  journal: { id: string; entryDate: string; body: string; createdAt: string }[];
  mood: {
    entryDate: string;
    moodScore: number;
    energyScore: number | null;
    sleepHours: number | null;
    emotionTags: string[];
  }[];
}

export class ClinicalPurge {
  private readonly pool: Pool;
  private readonly transit: TransitClient;

  constructor(pool: Pool, transit: TransitClient) {
    this.pool = pool;
    this.transit = transit;
  }

  /**
   * Decrypt everything and hand it over.
   *
   * The one operation on this platform that deliberately reverses the encryption in
   * bulk, and the reason `data_rights.export.delivered` is a sensitivity-5 audit event:
   * an entire account's private writing leaving the vault at once is the largest
   * disclosure the platform performs, even when the person asking owns it.
   *
   * A `maximum` privacy-mode entry cannot be included. The platform holds no key for
   * those, which is the whole point of the mode — they are listed by date so the member
   * knows they exist and that we could not read them either.
   */
  async exportFor(pseudoId: number): Promise<ClinicalExport> {
    const entries = await this.pool.query<{
      id: string;
      entry_date: Date;
      created_at: Date;
      body_ciphertext: Buffer;
      body_dek: Buffer;
      key_id: string;
      privacy_mode: string;
    }>(
      `SELECT id, entry_date, created_at, body_ciphertext, body_dek, key_id, privacy_mode
         FROM journal_entries
        WHERE pseudo_id = $1 AND deleted_at IS NULL
        ORDER BY entry_date`,
      [pseudoId],
    );

    const journal: ClinicalExport['journal'] = [];
    for (const row of entries.rows) {
      if (row.privacy_mode === 'maximum') {
        journal.push({
          id: row.id,
          entryDate: row.entry_date.toISOString().slice(0, 10),
          body: '[written in maximum privacy mode — encrypted with a key held only on your device, and unreadable to the platform]',
          createdAt: row.created_at.toISOString(),
        });
        continue;
      }
      journal.push({
        id: row.id,
        entryDate: row.entry_date.toISOString().slice(0, 10),
        // The record id is the AAD, exactly as it was when the entry was sealed —
        // which is what stops a ciphertext being moved between rows.
        body: await open(
          { ciphertext: row.body_ciphertext, wrappedDek: row.body_dek },
          this.transit,
          row.id,
        ),
        createdAt: row.created_at.toISOString(),
      });
    }

    const mood = await this.pool.query<{
      entry_date: Date;
      mood_score: number;
      energy_score: number | null;
      sleep_hours: string | null;
      emotion_tags: string[] | null;
    }>(
      `SELECT entry_date, mood_score, energy_score, sleep_hours, emotion_tags
         FROM mood_checkins
        WHERE pseudo_id = $1
        ORDER BY entry_date`,
      [pseudoId],
    );

    return {
      journal,
      mood: mood.rows.map((r) => ({
        entryDate: r.entry_date.toISOString().slice(0, 10),
        moodScore: r.mood_score,
        energyScore: r.energy_score,
        sleepHours: r.sleep_hours === null ? null : Number(r.sleep_hours),
        emotionTags: r.emotion_tags ?? [],
      })),
    };
  }

  /** Delete the rows. The wrapped keys go with them, and the ciphertext dies inert. */
  async purge(pseudoId: number): Promise<{ purged: number; held: number; detail: string[] }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const entries = await client.query(`DELETE FROM journal_entries WHERE pseudo_id = $1`, [
        pseudoId,
      ]);
      const mood = await client.query(`DELETE FROM mood_checkins WHERE pseudo_id = $1`, [pseudoId]);
      await client.query('COMMIT');

      return {
        purged: (entries.rowCount ?? 0) + (mood.rowCount ?? 0),
        held: 0,
        detail: [],
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
