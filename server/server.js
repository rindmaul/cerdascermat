import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { connectRedis, redis } from './database/db.js';
import { GameEngine } from './game/GameEngine.js';
import { registerSocketHandlers } from './socket/gameSocket.js';
import { query } from './database/db.js';

const app  = express();
const http = createServer(app);

// ── Middleware ────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
}));

// ── Socket.IO ─────────────────────────────────────────────────
const io = new Server(http, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET','POST'],
  },
  pingTimeout: 20_000,
  pingInterval: 10_000,
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e6,
});

// ── REST API ──────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.get('/api/rooms/active', async (req, res) => {
  const { rows } = await query(
    `SELECT code, status, max_questions, max_players, created_at
     FROM rooms WHERE status != 'finished' ORDER BY created_at DESC LIMIT 20`
  );
  res.json(rows);
});

app.get('/api/stats/:playerToken', async (req, res) => {
  try {
    const { rows: [player] } = await query(
      `SELECT p.id, p.display_name, ps.*
       FROM players p
       LEFT JOIN player_stats ps ON ps.player_id = p.id
       WHERE p.session_token = $1`,
      [req.params.playerToken]
    );
    if (!player) return res.status(404).json({ error: 'Player not found' });
    res.json(player);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/questions/count', async (req, res) => {
  const { rows: [row] } = await query('SELECT COUNT(*) as n FROM questions');
  res.json({ total: parseInt(row.n, 10) });
});

app.get('/api/questions/count-by-category', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT category, COUNT(*)::int AS count FROM questions GROUP BY category ORDER BY category`
    );
    // Hitung total semua soal untuk kategori "ALL"
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    res.json({ categories: rows, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Startup ───────────────────────────────────────────────────
async function start() {
  // Connect Redis
  await connectRedis();
  console.log('Redis connected');

  // Redis adapter for multi-instance scaling
  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  console.log('Socket.IO Redis adapter ready');

  // Initialize game engine
  const engine = new GameEngine(io);

  // Register socket handlers
  registerSocketHandlers(io, engine);

  // Socket.IO auth middleware (optional JWT or session token)
  io.use((socket, next) => {
    // Allow all connections for now; validate in event handlers
    next();
  });

  const PORT = process.env.PORT || 4000;
  http.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`   Frontend: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down…');
    engine.timerManager.clearAll();
    http.close(() => process.exit(0));
  });
}

start().catch((err) => {
  console.error('Startup error:', err);
  process.exit(1);
});
