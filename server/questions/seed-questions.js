/**
 * seed-questions.js
 * Run once: node server/questions/seed-questions.js
 * Imports all questions from the CerdasCermat bank into PostgreSQL.
 *
 * The RAW array below is copied directly from CerdasCermat.jsx
 * Format: [category, type, question, options_array_or_null, answer_idx]
 */

import 'dotenv/config';
import { pool } from '../database/db.js';

// ── Paste your full RAW array here ────────────────────────────
// (Copy the RAW array from CerdasCermat.jsx)
import { RAW } from './questions-data.js';

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM questions');  // clear existing

    let inserted = 0;
    for (const row of RAW) {
      const [cat, type, question, options, answerIdx] = row;
      await client.query(
        `INSERT INTO questions (category, type, question, options, answer_idx)
         VALUES ($1, $2, $3, $4, $5)`,
        [cat, type, question, options ? JSON.stringify(options) : null, answerIdx]
      );
      inserted++;
    }

    await client.query('COMMIT');
    console.log(`✅ Seeded ${inserted} questions`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
