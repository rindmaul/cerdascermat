import { query } from '../database/db.js';
import { setRoomState, getRoomState, delRoomState, REDIS_KEYS, redis } from '../database/db.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode() {
  let code = '';
  for (let i = 0; i < 7; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

/**
 * RoomManager
 * Stores live room state in Redis for speed.
 * Persists to PostgreSQL for history / stats.
 */
export class RoomManager {
  /**
   * Create a new room and return { room, code }.
   */
  static async createRoom({ hostId, hostName, maxQuestions, maxPlayers = 50 }) {
    let code;
    let tries = 0;

    // Ensure unique code
    while (tries < 10) {
      code = generateCode();
      const { rows } = await query(
        `SELECT id FROM rooms WHERE code = $1 AND status != 'finished'`,
        [code]
      );
      if (rows.length === 0) break;
      tries++;
    }

    const { rows } = await query(
      `INSERT INTO rooms (code, host_id, max_questions, max_players, status)
       VALUES ($1, $2, $3, $4, 'waiting') RETURNING *`,
      [code, hostId, maxQuestions, maxPlayers]
    );

    const room = rows[0];

    // Cache in Redis
    const state = {
      id: room.id,
      code,
      hostId,
      hostName,
      maxQuestions,
      maxPlayers,
      status: 'waiting',
      players: [],   // { id, name, socketId, isSpectator, connected }
      gameId: null,
      currentQuestion: 0,
    };
    await setRoomState(code, state);

    return { room, code, state };
  }

  /**
   * Add player to room. Returns updated state or error string.
   */
  static async joinRoom({ code, playerId, playerName, socketId }) {
    const state = await getRoomState(code);
    if (!state) return { error: 'Room tidak ditemukan' };
    if (state.status === 'finished') return { error: 'Game sudah selesai' };

    const existing = state.players.find((p) => p.id === playerId);
    if (existing) {
      // Reconnect
      existing.socketId = socketId;
      existing.connected = true;
      await setRoomState(code, state);
      return { state, rejoined: true };
    }

    const activePlayers = state.players.filter((p) => !p.isSpectator);
    const isSpectator = state.status === 'playing' || activePlayers.length >= state.maxPlayers;

    state.players.push({
      id: playerId,
      name: playerName,
      socketId,
      isSpectator,
      connected: true,
      score: 0,
      correct: 0,
      wrong: 0,
    });

    await setRoomState(code, state);
    return { state, isSpectator };
  }

  static async leaveRoom({ code, playerId }) {
    const state = await getRoomState(code);
    if (!state) return null;
    const p = state.players.find((p) => p.id === playerId);
    if (p) {
      p.connected = false;
      // Store reconnect window (30s)
      await redis.set(REDIS_KEYS.reconnect(playerId), code, { EX: 30 });
    }
    await setRoomState(code, state);
    return state;
  }

  static async updatePlayerSocket({ code, playerId, socketId }) {
    const state = await getRoomState(code);
    if (!state) return null;
    const p = state.players.find((p) => p.id === playerId);
    if (p) {
      p.socketId = socketId;
      p.connected = true;
      await setRoomState(code, state);
    }
    return state;
  }

  static async getRoomByCode(code) {
    return getRoomState(code);
  }

  static async setStatus(code, status) {
    const state = await getRoomState(code);
    if (!state) return null;
    state.status = status;
    await setRoomState(code, state);
    // Also update DB
    await query(`UPDATE rooms SET status = $1 WHERE code = $2`, [status, code]);
    if (status === 'playing') {
      await query(`UPDATE rooms SET started_at = NOW() WHERE code = $1`, [code]);
    } else if (status === 'finished') {
      await query(`UPDATE rooms SET finished_at = NOW() WHERE code = $1`, [code]);
    }
    return state;
  }

  static async setGameId(code, gameId) {
    const state = await getRoomState(code);
    if (!state) return null;
    state.gameId = gameId;
    await setRoomState(code, state);
    return state;
  }

  static async updateScores(code, scores) {
    // scores: { playerId: { score, correct, wrong } }
    const state = await getRoomState(code);
    if (!state) return null;
    for (const p of state.players) {
      if (scores[p.id]) {
        Object.assign(p, scores[p.id]);
      }
    }
    await setRoomState(code, state);
    return state;
  }

  static async cleanup(code) {
    await delRoomState(code);
  }

  /** List of active rooms (for admin/debug) */
  static async listActive() {
    const { rows } = await query(
      `SELECT code, status, max_questions, max_players, created_at
       FROM rooms WHERE status != 'finished' ORDER BY created_at DESC LIMIT 100`
    );
    return rows;
  }
}
