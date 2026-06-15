import pg from 'pg';
import { createClient } from 'redis';

const { Pool } = pg;

// ── PostgreSQL Pool ───────────────────────────────────────────
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 60000,
  ssl: { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('Unexpected PG pool error', err);
});

export async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 200) {
      console.warn(`Slow query (${duration}ms): ${text.slice(0, 80)}`);
    }
    return res;
  } catch (err) {
    console.error('DB query error:', err.message, '\nQuery:', text);
    throw err;
  }
}

export async function getClient() {
  const client = await pool.connect();
  const release = client.release.bind(client);
  client.release = () => {
    client.release = release;
    return release();
  };
  return client;
}

// ── Redis Client ──────────────────────────────────────────────
export const redis = createClient({
  url: process.env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 50, 2000),
  },
});

redis.on('error', (err) => console.error('Redis error:', err));
redis.on('connect', () => console.log('Redis connected'));

export async function connectRedis() {
  if (!redis.isOpen) {
    await redis.connect();
  }
  return redis;
}

// ── Redis helpers ─────────────────────────────────────────────
export const REDIS_KEYS = {
  roomState: (code) => `room:${code}:state`,
  roomPlayers: (code) => `room:${code}:players`,
  gameTimer: (roomCode) => `game:${roomCode}:timer`,
  leaderboard: (roomCode) => `game:${roomCode}:lb`,
  playerSession: (token) => `session:${token}`,
  reconnect: (playerId) => `reconnect:${playerId}`,
};

export async function setRoomState(code, state, ttlSeconds = 3600) {
  await redis.set(REDIS_KEYS.roomState(code), JSON.stringify(state), { EX: ttlSeconds });
}

export async function getRoomState(code) {
  const raw = await redis.get(REDIS_KEYS.roomState(code));
  return raw ? JSON.parse(raw) : null;
}

export async function delRoomState(code) {
  await redis.del(REDIS_KEYS.roomState(code));
  await redis.del(REDIS_KEYS.leaderboard(code));
}
