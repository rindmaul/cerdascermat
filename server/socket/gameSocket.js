import { RoomManager } from '../rooms/RoomManager.js';
import { query } from '../database/db.js';
import { redis, REDIS_KEYS } from '../database/db.js';
import { ScoreManager } from '../game/ScoreManager.js';
import crypto from 'crypto';

/**
 * gameSocket.js
 * Registers all Socket.IO event handlers.
 * engine — GameEngine instance
 */
export function registerSocketHandlers(io, engine) {

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // ── create-room ──────────────────────────────────────────
    socket.on('create-room', async ({ playerName, maxQuestions, categories, gameMode }, callback) => {
      try {
        await handleDisconnect(socket, io, engine, false);
        const safeGameMode = gameMode === 'team' ? 'team' : 'classic';

        // Create or reuse player session
        const sessionToken = crypto.randomBytes(32).toString('hex');
        const { rows: [player] } = await query(
          `INSERT INTO players (display_name, session_token) VALUES ($1, $2) RETURNING *`,
          [playerName, sessionToken]
        );

        const { code, state } = await RoomManager.createRoom({
          hostId: player.id,
          hostName: playerName,
          maxQuestions: parseInt(maxQuestions, 10),
          maxPlayers: safeGameMode === 'team' ? 3 : 50,
          categories: categories || ['ALL'],
          gameMode: safeGameMode,
        });

        await RoomManager.joinRoom({
          code,
          playerId: player.id,
          playerName,
          socketId: socket.id,
        });

        await socket.join(code);

        // Track player in socket data
        socket.data.playerId = player.id;
        socket.data.playerName = playerName;
        socket.data.roomCode = code;
        socket.data.sessionToken = sessionToken;
        socket.data.isHost = true;

        callback?.({ ok: true, code, playerId: player.id, sessionToken, isHost: true, state });
        console.log(`Room created: ${code} by ${playerName} (${maxQuestions} questions)`);
      } catch (err) {
        console.error('create-room error:', err);
        callback?.({ ok: false, error: 'Gagal membuat room' });
      }
    });

    // ── join-room ────────────────────────────────────────────
    socket.on('join-room', async ({ code, playerName, sessionToken }, callback) => {
      try {
        const upperCode = code.toUpperCase();
        const sameRoomSession =
          socket.data.roomCode === upperCode &&
          socket.data.sessionToken &&
          socket.data.sessionToken === sessionToken;

        if (socket.data.roomCode && !sameRoomSession) {
          await handleDisconnect(socket, io, engine, false);
        }

        // Upsert player
        let player;
        if (sessionToken) {
          const { rows } = await query(
            `SELECT * FROM players WHERE session_token = $1`, [sessionToken]
          );
          if (rows.length) {
            player = rows[0];
            // Update last seen
            await query(`UPDATE players SET last_seen_at=NOW() WHERE id=$1`, [player.id]);
          }
        }
        if (!player) {
          const newToken = crypto.randomBytes(32).toString('hex');
          const { rows: [p] } = await query(
            `INSERT INTO players (display_name, session_token) VALUES ($1, $2) RETURNING *`,
            [playerName, newToken]
          );
          player = p;
          sessionToken = newToken;
        }

        const result = await RoomManager.joinRoom({
          code: upperCode,
          playerId: player.id,
          playerName: player.display_name,
          socketId: socket.id,
        });

        if (result.error) {
          return callback?.({ ok: false, error: result.error });
        }

        await socket.join(upperCode);
        socket.data.playerId = player.id;
        socket.data.playerName = player.display_name;
        socket.data.roomCode = upperCode;
        socket.data.sessionToken = sessionToken;
        socket.data.isHost = result.state.hostId === player.id;

        // Notify room of new player
        socket.to(upperCode).emit('player-joined', {
          player: {
            id: player.id,
            name: player.display_name,
            role: result.state.players.find((p) => p.id === player.id)?.role ?? null,
            isSpectator: result.isSpectator,
            connected: true,
          },
        });

        callback?.({
          ok: true,
          playerId: player.id,
          sessionToken,
          isHost: socket.data.isHost,
          isSpectator: result.isSpectator,
          rejoined: result.rejoined ?? false,
          state: {
            code: upperCode,
            status: result.state.status,
            maxQuestions: result.state.maxQuestions,
            gameMode: result.state.gameMode ?? 'classic',
            hostId: result.state.hostId,
            players: serializePlayers(result.state.players),
          },
        });

        // If game already running, catch up spectator / rejoin
        if (result.state.status === 'playing' && result.rejoined) {
          socket.emit('game-started', {
            roomCode: upperCode,
            totalQuestions: result.state.maxQuestions,
            gameId: result.state.gameId,
            gameMode: result.state.gameMode ?? 'classic',
            players: serializePlayers(result.state.players),
          });
        }
      } catch (err) {
        console.error('join-room error:', err);
        callback?.({ ok: false, error: 'Gagal join room' });
      }
    });

    // ── start-game ───────────────────────────────────────────
    socket.on('assign-role', async ({ playerId, role }, callback) => {
      try {
        const { playerId: hostId, roomCode } = socket.data;
        if (!hostId || !roomCode) return callback?.({ ok: false, error: 'Belum masuk room' });

        const result = await RoomManager.assignRole({
          code: roomCode,
          hostId,
          playerId,
          role: role ?? null,
        });

        if (result.error) return callback?.({ ok: false, error: result.error });

        const players = serializePlayers(result.state.players);
        io.to(roomCode).emit('roles-updated', { roomCode, players });
        callback?.({ ok: true, players });
      } catch (err) {
        console.error('assign-role error:', err);
        callback?.({ ok: false, error: 'Gagal mengatur role' });
      }
    });

    socket.on('start-game', async (_, callback) => {
      try {
        const { playerId, roomCode } = socket.data;
        const state = await RoomManager.getRoomByCode(roomCode);

        if (!state) return callback?.({ ok: false, error: 'Room tidak ditemukan' });
        if (state.hostId !== playerId) return callback?.({ ok: false, error: 'Bukan host' });
        if (state.status !== 'waiting') return callback?.({ ok: false, error: 'Game sudah mulai' });

        const activePlayers = state.players.filter(p => !p.isSpectator && p.connected);
        const gameMode = state.gameMode ?? 'classic';

        if (gameMode === 'team') {
          if (activePlayers.length !== 3) {
            return callback?.({ ok: false, error: 'Harus ada tepat 3 pemain aktif' });
          }

          const roles = new Set(activePlayers.map((p) => p.role));
          if (!roles.has('moderator') || !roles.has('team1') || !roles.has('team2')) {
            return callback?.({ ok: false, error: 'Host harus menentukan moderator, Tim 1, dan Tim 2' });
          }
        } else if (activePlayers.length < 1) {
          return callback?.({ ok: false, error: 'Minimal 1 pemain' });
        }

        await engine.startGame(roomCode, state);
        callback?.({ ok: true });
      } catch (err) {
        console.error('start-game error:', err);
        callback?.({ ok: false, error: err.message });
      }
    });

    // ── submit-answer ────────────────────────────────────────
    socket.on('submit-answer', async ({ chosenIdx }) => {
      const { playerId, roomCode } = socket.data;
      if (!playerId || !roomCode) return;

      await engine.submitAnswer({
        roomCode,
        playerId,
        chosenIdx: parseInt(chosenIdx, 10),
        socketId: socket.id,
      });
    });

    socket.on('buzz-in', async (_, callback) => {
      try {
        const { playerId, roomCode } = socket.data;
        if (!playerId || !roomCode) return callback?.({ ok: false, error: 'Belum masuk room' });

        const result = await engine.buzzIn({
          roomCode,
          playerId,
          socketId: socket.id,
        });
        callback?.(result);
      } catch (err) {
        console.error('buzz-in error:', err);
        callback?.({ ok: false, error: 'Gagal menekan tombol' });
      }
    });

    socket.on('moderator-submit-answer', async ({ chosenIdx }, callback) => {
      try {
        const { playerId, roomCode } = socket.data;
        if (!playerId || !roomCode) return callback?.({ ok: false, error: 'Belum masuk room' });

        const result = await engine.submitModeratedAnswer({
          roomCode,
          moderatorId: playerId,
          chosenIdx: parseInt(chosenIdx, 10),
        });
        callback?.(result);
      } catch (err) {
        console.error('moderator-submit-answer error:', err);
        callback?.({ ok: false, error: 'Gagal menyimpan jawaban' });
      }
    });

    // ── get-leaderboard ──────────────────────────────────────
    socket.on('get-leaderboard', async (_, callback) => {
      try {
        const { roomCode } = socket.data;
        const state = await RoomManager.getRoomByCode(roomCode);
        if (!state) return callback?.([]);
        const session = engine.getSession(roomCode);
        if (!session) return callback?.([]);
        const lb = ScoreManager.buildLeaderboard(state.players, session.gameTotals);
        callback?.(lb);
      } catch (e) {
        callback?.([]);
      }
    });

    // ── leave-room ───────────────────────────────────────────
    socket.on('leave-room', async () => {
      await handleDisconnect(socket, io, engine, false);
    });

    // ── disconnect ───────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      console.log(`Socket disconnected: ${socket.id} (${reason})`);
      await handleDisconnect(socket, io, engine, true);
    });

    // ── ping (latency check) ─────────────────────────────────
    socket.on('ping-check', (ts, callback) => {
      callback?.(ts);
    });
    // ── get-current-question (untuk reconnect) ───────────────
    socket.on('get-current-question', (_, callback) => {
      const { roomCode } = socket.data;
      const session = engine.getSession(roomCode);
      if (!session || session.status !== 'question-open') {
        return callback?.({ question: null });
      }
      const q = session.questions[session.currentIndex];
      const elapsed = Math.floor((Date.now() - session.questionStartedAt) / 1000);
      const totalSeconds = Math.ceil((session.questionDurationMs ?? 120_000) / 1000);
      const remaining = Math.max(0, totalSeconds - elapsed);
      callback?.({
        roomCode,
        question: q ? { ...q, ans: undefined } : null,
        no: session.currentIndex + 1,
        total: session.totalQuestions,
        duration: session.questionDurationMs ?? 120_000,
        remaining,
        gameMode: session.gameMode ?? 'classic',
        currentBuzz: session.currentBuzz,
        attemptedPlayerIds: [...(session.attemptedPlayers ?? [])],
        lastAttempt: session.lastAttempt ?? null,
      });
    });
  });
}



async function handleDisconnect(socket, io, engine, temporary) {
  const { playerId, roomCode, playerName, isHost } = socket.data;
  if (!playerId || !roomCode) return;

  const state = await RoomManager.leaveRoom({ code: roomCode, playerId });
  if (socket.rooms?.has(roomCode)) {
    await socket.leave(roomCode);
  }

  if (!state) {
    if (!temporary) clearSocketRoomData(socket);
    return;
  }

  io.to(roomCode).emit('player-left', {
    playerId,
    playerName,
    temporary,
  });

  // If host disconnected and game not started, maybe transfer host?
  if (isHost && state.status === 'waiting') {
    const others = state.players.filter(p => p.id !== playerId && p.connected && !p.isSpectator);
    if (others.length > 0) {
      await RoomManager.setHost({ code: roomCode, hostId: others[0].id, hostName: others[0].name });
      io.to(roomCode).emit('host-changed', { newHostId: others[0].id, newHostName: others[0].name });
    }
  }

  const connectedPlayers = state.players.filter((p) => !p.isSpectator && p.connected);
  if (!temporary && state.status === 'playing' && connectedPlayers.length === 0) {
    await engine.cancelGame(roomCode, 'all-players-left');
  }

  if (!temporary) clearSocketRoomData(socket);
}

function clearSocketRoomData(socket) {
  delete socket.data.playerId;
  delete socket.data.playerName;
  delete socket.data.roomCode;
  delete socket.data.sessionToken;
  delete socket.data.isHost;
}

function serializePlayers(players = []) {
  return players.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role ?? null,
    isSpectator: p.isSpectator,
    connected: p.connected,
  }));
}
