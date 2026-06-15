import { query } from '../database/db.js';

/**
 * QuestionService — loads & shuffles questions for a game session.
 * Questions are stored in PostgreSQL.
 * Seed script (seed-questions.js) imports from CerdasCermat bank.
 */
export class QuestionService {
  /**
   * Pick `count` random questions from the bank (no duplicates).
   * Returns array of question objects ready to send to clients.
   */
  static async pickQuestions(count) {
    const { rows } = await query(
      `SELECT id, category, type, question, options, answer_idx
       FROM questions
       ORDER BY RANDOM()
       LIMIT $1`,
      [count]
    );
    return rows.map((r) => ({
      id: r.id,
      cat: r.category,
      type: r.type,
      q: r.question,
      opts: r.options,       // array or null
      ans: r.answer_idx,     // server-only, never sent to client
    }));
  }

  /**
   * Save game question order to DB for audit / replay.
   */
  static async saveGameQuestions(gameId, questions) {
    const values = questions
      .map((q, i) => `('${gameId}', ${q.id}, ${i + 1})`)
      .join(',');
    await query(
      `INSERT INTO game_questions (game_id, question_id, question_no) VALUES ${values}`
    );
  }

  /**
   * Mark question as shown (for timing).
   */
  static async markShown(gameId, questionNo) {
    await query(
      `UPDATE game_questions SET shown_at = NOW()
       WHERE game_id = $1 AND question_no = $2`,
      [gameId, questionNo]
    );
  }

  /**
   * Mark question as closed.
   */
  static async markClosed(gameId, questionNo) {
    await query(
      `UPDATE game_questions SET closed_at = NOW()
       WHERE game_id = $1 AND question_no = $2`,
      [gameId, questionNo]
    );
  }

  /**
   * Strip the answer before sending to clients.
   */
  static clientSafe(question) {
    const { ans: _omit, ...safe } = question;
    return safe;
  }

  /**
   * Count total questions available in the bank.
   */
  static async totalCount() {
    const { rows } = await query('SELECT COUNT(*) AS n FROM questions');
    return parseInt(rows[0].n, 10);
  }

  /**
   * Get total available per category.
   */
  static async countByCategory() {
    const { rows } = await query(
      `SELECT category, COUNT(*) AS n FROM questions GROUP BY category ORDER BY category`
    );
    return rows;
  }
}
