import { query } from '../database/db.js';

export class QuestionService {
  static async pickQuestions(count, categories = ['ALL']) {
    const isAll = categories.includes('ALL') || categories.length === 0;
    const { rows } = await query(
      !isAll
        ? `SELECT id, category, type, question, options, answer_idx
           FROM questions
           WHERE category = ANY($2)
           ORDER BY RANDOM()
           LIMIT $1`
        : `SELECT id, category, type, question, options, answer_idx
           FROM questions
           ORDER BY RANDOM()
           LIMIT $1`,
      !isAll ? [count, categories] : [count]
    );
    return rows.map((r) => ({
      id: r.id,
      cat: r.category,
      type: r.type,
      q: r.question,
      opts: r.options,
      ans: r.answer_idx,
    }));
  }

  static async saveGameQuestions(gameId, questions) {
    const values = questions
      .map((q, i) => `('${gameId}', ${q.id}, ${i + 1})`)
      .join(',');
    await query(
      `INSERT INTO game_questions (game_id, question_id, question_no) VALUES ${values}`
    );
  }

  static async markShown(gameId, questionNo) {
    await query(
      `UPDATE game_questions SET shown_at = NOW()
       WHERE game_id = $1 AND question_no = $2`,
      [gameId, questionNo]
    );
  }

  static async markClosed(gameId, questionNo) {
    await query(
      `UPDATE game_questions SET closed_at = NOW()
       WHERE game_id = $1 AND question_no = $2`,
      [gameId, questionNo]
    );
  }

  static clientSafe(question) {
    const { ans: _omit, ...safe } = question;
    return safe;
  }

  static async totalCount() {
    const { rows } = await query('SELECT COUNT(*) AS n FROM questions');
    return parseInt(rows[0].n, 10);
  }

  static async countByCategory() {
    const { rows } = await query(
      `SELECT category, COUNT(*) AS n FROM questions GROUP BY category ORDER BY category`
    );
    return rows;
  }
}