import { query } from '../database/db.js';
import { RoomManager } from '../rooms/RoomManager.js';
import { QuestionService } from '../questions/QuestionService.js';
import { ScoreManager, pointsForRank } from './ScoreManager.js';
import { TimerManager } from './TimerManager.js';

const QUESTION_DURATION_MS = 30_000;
const RESULT_PAUSE_MS      = 4_000;

/**
 * GameEngine
 * Orchestrates one game session per room.
 * io — Socket.IO server instance (injected).
 */
export class GameEngine {
  constructor(io) {
    this.io = io;
    this.timerManager = new TimerManager();
    // Map<roomCode, GameSession>
    this.sessions = new Map();
  }

  // ── Public API ────────────────────────────────────────────

  /**
   * Start a new game for a room.
   */
  async startGame(roomCode, roomState) {
    if (this.sessions.has(roomCode)) {
      throw new Error('Game already running for this room');
    }

    // Klaim slot SEKARANG (sinkron, sebelum await pertama) supaya
    // panggilan start-game kedua yang nyelip di antara awal & selesainya
    // proses ini langsung ditolak oleh pengecekan di atas, bukan
    // malah lolos dan membuat sesi+timer kedua untuk room yang sama.
    this.sessions.set(roomCode, { status: 'starting' });

    const totalQuestions = roomState.maxQuestions;
    const category = roomState.category || 'ALL'; // ← tambah ini
    

    // Create game record in DB
    const { rows: [gameRow] } = await query(
      `INSERT INTO games (room_id, total_questions)
       SELECT id, $2 FROM rooms WHERE code = $1 RETURNING id`,
      [roomCode, totalQuestions]
    );
    const gameId = gameRow.id;

    // Pick questions
    const questions = await QuestionService.pickQuestions(totalQuestions, category);
    // Cap ke jumlah soal yang benar-benar tersedia di DB
    const actualTotal = Math.min(totalQuestions, questions.length);
    await QuestionService.saveGameQuestions(gameId, questions);

    // Create participant records
    const participantMap = new Map(); // playerId -> participantId
    for (const p of roomState.players) {
      if (p.isSpectator) continue;
      const { rows: [part] } = await query(
        `INSERT INTO game_participants (game_id, player_id, display_name, is_spectator)
         VALUES ($1, $2, $3, false) RETURNING id`,
        [gameId, p.id, p.name]
      );
      participantMap.set(p.id, part.id);
    }

    const scoreManager = new ScoreManager(gameId);
    const gameTotals = new Map(); // playerId -> { score, correct, wrong, totalMs }
    for (const p of roomState.players) {
      if (!p.isSpectator) {
        gameTotals.set(p.id, { score: 0, correct: 0, wrong: 0, totalMs: 0 });
      }
    }

    const session = {
      gameId,
      roomCode,
      questions,
      currentIndex: -1,
      totalQuestions: actualTotal,
      scoreManager,
      gameTotals,
      participantMap,
      questionStartedAt: null,
      answeredPlayers: new Set(),
      status: 'running',
      resultTimeout: null,        // track pending setTimeout for cleanup
    };

    this.sessions.set(roomCode, session);
    await RoomManager.setStatus(roomCode, 'playing');
    await RoomManager.setGameId(roomCode, gameId);

    // Broadcast game start
    this.io.to(roomCode).emit('game-started', {
      roomCode,
      totalQuestions: actualTotal,
      gameId,
    });

    // Start first question after brief delay
    setTimeout(() => this.nextQuestion(roomCode), 1500);
  }

  /**
   * Process a player's answer submission.
   */
  async submitAnswer({ roomCode, playerId, chosenIdx, socketId }) {
    const session = this.sessions.get(roomCode);
    if (!session || session.status !== 'question-open') return;

    // Prevent double-submit
    if (session.answeredPlayers.has(playerId)) return;
    session.answeredPlayers.add(playerId);

    const q = session.questions[session.currentIndex];
    const responseMs = Date.now() - session.questionStartedAt;

    const result = session.scoreManager.submitAnswer({
      questionNo: session.currentIndex + 1,
      playerId,
      chosenIdx,
      correctIdx: q.ans,
      responseMs,
    });

    if (!result) return;

    // Update running totals
    const totals = session.gameTotals.get(playerId) ?? { score: 0, correct: 0, wrong: 0, totalMs: 0 };
    totals.score   += result.points;
    totals.correct += result.isCorrect ? 1 : 0;
    totals.wrong   += result.isCorrect ? 0 : 1;
    totals.totalMs += responseMs;
    session.gameTotals.set(playerId, totals);

    // Send personal feedback to the player
    this.io.to(socketId).emit('answer-result', {
      roomCode,
      isCorrect: result.isCorrect,
      points: result.points,
      rank: result.rank,
      correctIdx: q.ans,
    });

    // Check if all active players have answered
    const roomState = await RoomManager.getRoomByCode(roomCode);
    if (roomState) {
      const activePlayers = roomState.players.filter((p) => !p.isSpectator && p.connected);
      if (session.answeredPlayers.size >= activePlayers.length) {
        this.closeQuestion(roomCode);
      }
    }
  }

  // ── Private helpers ───────────────────────────────────────

  async nextQuestion(roomCode) {
    const session = this.sessions.get(roomCode);
    if (!session || session.status === 'finished') return;

    session.currentIndex++;

    // Guard: finish jika sudah melewati totalQuestions ATAU questions habis
    if (session.currentIndex >= session.totalQuestions ||
        session.currentIndex >= session.questions.length) {
      return this.finishGame(roomCode);
    }

    const q = session.questions[session.currentIndex];
    session.scoreManager.startQuestion(session.currentIndex + 1);
    session.answeredPlayers = new Set();
    session.questionStartedAt = Date.now();
    session.status = 'question-open';

    // Mark shown in DB
    await QuestionService.markShown(session.gameId, session.currentIndex + 1);

    // Broadcast question (NO answer)
    this.io.to(roomCode).emit('question-start', {
      roomCode,
      no: session.currentIndex + 1,
      total: session.totalQuestions,
      question: QuestionService.clientSafe(q),
      duration: QUESTION_DURATION_MS,
      serverTime: Date.now(),
    });

    // Start server-side timer
    this.timerManager.startTimer(
      roomCode,
      QUESTION_DURATION_MS,
      (remaining) => {
        this.io.to(roomCode).emit('timer-tick', { roomCode, remaining });
      },
      () => {
        this.closeQuestion(roomCode);
      }
    );
  }

  async closeQuestion(roomCode) {
    const session = this.sessions.get(roomCode);
    if (!session || session.status !== 'question-open') return;

    session.status = 'result';
    this.timerManager.clearTimer(roomCode);

    const q = session.questions[session.currentIndex];
    await QuestionService.markClosed(session.gameId, session.currentIndex + 1);

    // Build result summary
    const roomState = await RoomManager.getRoomByCode(roomCode);
    const fastestCorrect = session.scoreManager.getQuestionResult(
      session.currentIndex + 1,
      roomState?.players ?? []
    );

    // Build leaderboard
    const lb = ScoreManager.buildLeaderboard(
      roomState?.players ?? [],
      session.gameTotals
    );

    // Broadcast question result
    this.io.to(roomCode).emit('question-end', {
      roomCode,
      no: session.currentIndex + 1,
      correctIdx: q.ans,
      correctLabel: q.type === 'tf'
        ? (q.ans === 0 ? 'BENAR' : 'SALAH')
        : ['A','B','C','D'][q.ans],
      fastestCorrect,
      leaderboard: lb.slice(0, 10),
    });

    // Broadcast leaderboard update
    this.io.to(roomCode).emit('leaderboard-update', { roomCode, leaderboard: lb });

    // Persist answers
    try {
      const { rows: [gq] } = await query(
        `SELECT id FROM game_questions WHERE game_id=$1 AND question_no=$2`,
        [session.gameId, session.currentIndex + 1]
      );
      if (gq) {
        await session.scoreManager.persistQuestionAnswers(gq.id, session.participantMap);
      }
    } catch (e) {
      console.error('Persist error:', e.message);
    }

    // Next question after pause — simpan ref supaya bisa di-clear
    session.resultTimeout = setTimeout(() => {
      session.resultTimeout = null;
      session.status = 'running';
      this.nextQuestion(roomCode);
    }, RESULT_PAUSE_MS);
  }

  async finishGame(roomCode) {
    const session = this.sessions.get(roomCode);
    if (!session) return;

    session.status = 'finished';
    this.timerManager.clearTimer(roomCode);

    // Clear pending result timeout agar tidak memicu nextQuestion
    // untuk session yang sudah selesai
    if (session.resultTimeout) {
      clearTimeout(session.resultTimeout);
      session.resultTimeout = null;
    }

    const roomState = await RoomManager.getRoomByCode(roomCode);
    const lb = ScoreManager.buildLeaderboard(
      roomState?.players ?? [],
      session.gameTotals
    );

    // Persist final scores
    for (const entry of lb) {
      const participantId = session.participantMap.get(entry.id);
      if (!participantId) continue;
      await query(
        `UPDATE game_participants
         SET total_score=$1, correct_count=$2, wrong_count=$3,
             total_time_ms=$4, final_rank=$5
         WHERE id=$6`,
        [entry.score, entry.correct, entry.wrong, entry.totalMs, entry.rank, participantId]
      );
    }

    // Mark game finished
    await query(`UPDATE games SET finished_at=NOW() WHERE id=$1`, [session.gameId]);
    await RoomManager.setStatus(roomCode, 'finished');

    // Build final stats
    const finalStats = lb.map((p) => ({
      ...p,
      accuracy: p.correct + p.wrong > 0
        ? Math.round((p.correct / (p.correct + p.wrong)) * 100)
        : 0,
      avgMs: p.correct > 0 ? Math.round(p.totalMs / p.correct) : 0,
    }));

    this.io.to(roomCode).emit('game-finished', {
      roomCode,
      leaderboard: finalStats,
      gameId: session.gameId,
    });

    // Cleanup session
    this.sessions.delete(roomCode);

    console.log(`✅ Game finished: room=${roomCode} questions=${session.totalQuestions}`);
  }

  getSession(roomCode) {
    return this.sessions.get(roomCode);
  }

  async cancelGame(roomCode, reason = 'abandoned') {
    const session = this.sessions.get(roomCode);
    if (!session) return;

    this.timerManager.clearTimer(roomCode);

    if (session.resultTimeout) {
      clearTimeout(session.resultTimeout);
      session.resultTimeout = null;
    }

    session.status = 'finished';
    this.sessions.delete(roomCode);

    if (session.gameId) {
      await query(
        `UPDATE games SET finished_at=NOW()
         WHERE id=$1 AND finished_at IS NULL`,
        [session.gameId]
      );
    }

    await RoomManager.setStatus(roomCode, 'finished');
    this.io.to(roomCode).emit('game-cancelled', { roomCode, reason });

    console.log(`Game cancelled: room=${roomCode} reason=${reason}`);
  }

  isRunning(roomCode) {
    return this.sessions.has(roomCode);
  }
}
