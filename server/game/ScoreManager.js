import { query } from '../database/db.js';

// Points by speed rank (1-indexed)
const RANK_POINTS = [100, 75, 50, 25];

export function pointsForRank(rank) {
  if (rank <= 0) return 0;
  return RANK_POINTS[Math.min(rank - 1, RANK_POINTS.length - 1)];
}

/**
 * ScoreManager
 * Tracks per-question answer submissions in memory during a game,
 * then persists to DB when question closes.
 */
export class ScoreManager {
  constructor(gameId) {
    this.gameId = gameId;
    // Map<questionNo, Map<playerId, { chosenIdx, isCorrect, responseMs, rank, points }>>
    this.answers = new Map();
    // Map<questionNo, correctAnswerRank> — how many correct answers received so far
    this.correctRanks = new Map();
  }

  startQuestion(questionNo) {
    this.answers.set(questionNo, new Map());
    this.correctRanks.set(questionNo, 0);
  }

  /**
   * Record a player's answer. Returns { isCorrect, rank, points }.
   * correctIdx — the right answer index.
   */
  submitAnswer({ questionNo, playerId, chosenIdx, correctIdx, responseMs, pointsForCorrect }) {
    const qAnswers = this.answers.get(questionNo);
    if (!qAnswers) return null;

    // Already answered
    if (qAnswers.has(playerId)) return qAnswers.get(playerId);

    const isCorrect = chosenIdx === correctIdx;
    let rank = null;
    let points = 0;

    if (isCorrect) {
      const currentRank = (this.correctRanks.get(questionNo) || 0) + 1;
      this.correctRanks.set(questionNo, currentRank);
      rank = currentRank;
      points = pointsForCorrect ?? pointsForRank(rank);
    }

    const result = { chosenIdx, isCorrect, responseMs, rank, points };
    qAnswers.set(playerId, result);
    return result;
  }

  /**
   * How many players have answered for this question.
   */
  answerCount(questionNo) {
    return this.answers.get(questionNo)?.size ?? 0;
  }

  /**
   * Get all answers for a question (for displaying results).
   */
  getQuestionAnswers(questionNo) {
    return this.answers.get(questionNo) ?? new Map();
  }

  /**
   * Build leaderboard from accumulated scores.
   * players: array of { id, name }
   * gameTotals: Map<playerId, { score, correct, wrong, totalMs }>
   */
  static buildLeaderboard(players, gameTotals) {
    return players
      .filter((p) => !p.isSpectator && p.role !== 'moderator')
      .map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role ?? null,
        score: gameTotals.get(p.id)?.score ?? 0,
        correct: gameTotals.get(p.id)?.correct ?? 0,
        wrong: gameTotals.get(p.id)?.wrong ?? 0,
        totalMs: gameTotals.get(p.id)?.totalMs ?? 0,
      }))
      .sort((a, b) => b.score - a.score || a.totalMs - b.totalMs)
      .map((p, i) => ({ ...p, rank: i + 1 }));
  }

  /**
   * Persist all answers for a question to DB.
   */
  async persistQuestionAnswers(gameQuestionId, participantMap) {
    const qAnswers = [...this.answers.values()].pop();
    if (!qAnswers || qAnswers.size === 0) return;

    for (const [playerId, ans] of qAnswers) {
      const participantId = participantMap.get(playerId);
      if (!participantId) continue;
      try {
        await query(
          `INSERT INTO answers
             (game_question_id, participant_id, chosen_idx, is_correct, response_time_ms, speed_rank, points_earned)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT DO NOTHING`,
          [gameQuestionId, participantId, ans.chosenIdx, ans.isCorrect, ans.responseMs, ans.rank, ans.points]
        );
      } catch (e) {
        console.error('Error persisting answer:', e.message);
      }
    }
  }

  /**
   * Build the per-question result summary to broadcast after question closes.
   * Returns array of top correct answers sorted by speed.
   */
  getQuestionResult(questionNo, players) {
    const qAnswers = this.answers.get(questionNo) ?? new Map();
    const playerMap = Object.fromEntries(players.map((p) => [p.id, p.name]));

    const correct = [];
    for (const [playerId, ans] of qAnswers) {
      if (ans.isCorrect) {
        correct.push({
          name: playerMap[playerId] ?? '?',
          rank: ans.rank,
          points: ans.points,
          ms: ans.responseMs,
        });
      }
    }
    correct.sort((a, b) => a.rank - b.rank);
    return correct.slice(0, 10); // top 10
  }
}
