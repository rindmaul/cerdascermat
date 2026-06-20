import { query } from '../database/db.js';
import { setRoomState, getRoomState, delRoomState, REDIS_KEYS, redis } from '../database/db.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PLAYER_ROLES = new Set(['moderator', 'team1', 'team2']);
const GAME_MODES = new Set(['classic', 'team']);

// ── Lock per-roomCode ──────────────────────────────────────────
// Mencegah dua operasi read-modify-write ke Redis untuk room yang SAMA
// berjalan bersamaan (yang nulis belakangan akan menimpa habis perubahan
// yang nulis duluan). Operasi-operasi yang mengubah state room dijalankan
// berurutan (di-queue) per roomCode lewat helper ini.
const roomLocks = new Map(); // code -> Promise<void> (tail antrian)

function withRoomLock(code, fn) {
  const prevTail = roomLocks.get(code) || Promise.resolve();
  const run = prevTail.then(fn, fn); // jalankan fn setelah antrian sebelumnya selesai (apapun hasilnya)
  roomLocks.set(code, run.then(() => {}, () => {})); // tail baru, selalu resolve, untuk antrian berikutnya
  return run; // caller tetap dapat hasil/error asli dari fn()
}

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
  static async createRoom({ hostId, hostName, maxQuestions, maxPlayers, category = 'ALL', gameMode = 'classic' }) {
    const safeGameMode = GAME_MODES.has(gameMode) ? gameMode : 'classic';
    const safeMaxPlayers = maxPlayers ?? (safeGameMode === 'team' ? 3 : 50);
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
      [code, hostId, maxQuestions, safeMaxPlayers]
    );

    const room = rows[0];

    // Cache in Redis
    const state = {
      id: room.id,
      code,
      hostId,
      hostName,
      maxQuestions,
      maxPlayers: safeMaxPlayers,
      category,        // ← tambah ini
      gameMode: safeGameMode,
      status: 'waiting',
      players: [],   // { id, name, socketId, role, isSpectator, connected }
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
    return withRoomLock(code, async () => {
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
        role: null,
        isSpectator,
        connected: true,
        score: 0,
        correct: 0,
        wrong: 0,
      });

      await setRoomState(code, state);
      return { state, isSpectator };
    });
  }

  static async leaveRoom({ code, playerId }) {
    return withRoomLock(code, async () => {
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
    });
  }

  static async updatePlayerSocket({ code, playerId, socketId }) {
    return withRoomLock(code, async () => {
      const state = await getRoomState(code);
      if (!state) return null;
      const p = state.players.find((p) => p.id === playerId);
      if (p) {
        p.socketId = socketId;
        p.connected = true;
        await setRoomState(code, state);
      }
      return state;
    });
  }

  static async getRoomByCode(code) {
    return getRoomState(code);
  }

  static async setStatus(code, status) {
    return withRoomLock(code, async () => {
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
    });
  }

  static async setGameId(code, gameId) {
    return withRoomLock(code, async () => {
      const state = await getRoomState(code);
      if (!state) return null;
      state.gameId = gameId;
      await setRoomState(code, state);
      return state;
    });
  }

  static async updateScores(code, scores) {
    return withRoomLock(code, async () => {
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
    });
  }

  static async assignRole({ code, hostId, playerId, role }) {
    return withRoomLock(code, async () => {
      const state = await getRoomState(code);
      if (!state) return { error: 'Room tidak ditemukan' };
      if (state.hostId !== hostId) return { error: 'Hanya host yang bisa mengatur role' };
      if (state.status !== 'waiting') return { error: 'Role hanya bisa diatur sebelum game mulai' };
      if ((state.gameMode ?? 'classic') !== 'team') return { error: 'Role hanya tersedia di mode tim' };
      if (role !== null && !PLAYER_ROLES.has(role)) return { error: 'Role tidak valid' };

      const player = state.players.find((p) => p.id === playerId && !p.isSpectator);
      if (!player) return { error: 'Pemain tidak ditemukan' };

      if (role) {
        for (const p of state.players) {
          if (p.id !== playerId && p.role === role) {
            p.role = null;
          }
        }
      }

      player.role = role;
      await setRoomState(code, state);
      return { state };
    });
  }

  static async setHost({ code, hostId, hostName }) {
    return withRoomLock(code, async () => {
      const state = await getRoomState(code);
      if (!state) return null;
      state.hostId = hostId;
      state.hostName = hostName;
      await setRoomState(code, state);
      return state;
    });
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
