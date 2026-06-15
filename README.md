# CerdasCermat Multiplayer — Setup & Deployment Guide

## Struktur Proyek
```
cerdascermat/
├── server/                    ← Backend (Railway/Render)
│   ├── server.js              ← Entry point Express + Socket.IO
│   ├── socket/
│   │   └── gameSocket.js      ← Semua event handler Socket.IO
│   ├── rooms/
│   │   └── RoomManager.js     ← Manajemen room (Redis + PostgreSQL)
│   ├── game/
│   │   ├── GameEngine.js      ← State machine utama game
│   │   ├── TimerManager.js    ← Timer server-side (anti-cheat)
│   │   └── ScoreManager.js    ← Perhitungan poin & ranking kecepatan
│   ├── database/
│   │   ├── db.js              ← PostgreSQL pool + Redis client
│   │   └── schema.sql         ← DDL schema lengkap
│   └── questions/
│       ├── QuestionService.js ← Service ambil soal dari DB
│       └── seed-questions.js  ← Import soal dari CerdasCermat.jsx
│
├── src/                       ← Frontend React (Vercel)
│   ├── pages/
│   │   ├── Home.jsx           ← Buat / Gabung room
│   │   ├── Lobby.jsx          ← Waiting room
│   │   ├── Game.jsx           ← Layar game utama
│   │   └── Result.jsx         ← Final leaderboard
│   ├── components/
│   │   ├── Timer.jsx          ← Countdown visual
│   │   ├── QuestionCard.jsx   ← MC + True/False card
│   │   ├── Leaderboard.jsx    ← Sidebar realtime
│   │   ├── PlayerList.jsx     ← Daftar pemain di lobby
│   │   └── ScoreAnimation.jsx ← +100 popup animation
│   ├── socket/
│   │   └── socket.js          ← Socket.IO singleton + helpers
│   ├── App.jsx                ← Router
│   └── main.jsx               ← Entry point
│
├── package.json               ← Frontend deps
├── vite.config.js
├── server/package.json        ← Backend deps
└── .env.example               ← Template environment variables
```

---

## 1. Setup Database (Neon PostgreSQL)

1. Buat akun di https://neon.tech (gratis)
2. Buat project baru → copy connection string
3. Jalankan schema:
```bash
psql $DATABASE_URL -f server/database/schema.sql
```

---

## 2. Setup Redis (Upstash)

1. Buat akun di https://upstash.com (gratis)
2. Create Redis database → copy `REDIS_URL`

---

## 3. Import Soal ke Database

1. Copy file `CerdasCermat.jsx` ke folder `server/questions/`
2. Buat file `server/questions/questions-data.js`:
```js
// Export RAW array dari CerdasCermat.jsx
export const RAW = [
  // paste isi array RAW dari CerdasCermat.jsx di sini
];
```
3. Jalankan seed:
```bash
cd server
npm install
node questions/seed-questions.js
```

---

## 4. Deploy Backend ke Railway

1. Buat akun di https://railway.app
2. New Project → Deploy from GitHub
3. Set environment variables:
   ```
   DATABASE_URL=...
   REDIS_URL=...
   FRONTEND_URL=https://cerdascermat.vercel.app
   NODE_ENV=production
   PORT=4000
   ```
4. Set start command: `node server/server.js`
5. Copy Railway URL (contoh: `https://cerdascermat.railway.app`)

---

## 5. Deploy Frontend ke Vercel

1. Buat akun di https://vercel.com
2. Import GitHub repo
3. Set environment variable:
   ```
   VITE_BACKEND_URL=https://cerdascermat.railway.app
   ```
4. Build command: `npm run build`
5. Output directory: `dist`

---

## 6. Local Development

### Backend:
```bash
cd server
npm install
cp ../.env.example .env   # isi DATABASE_URL dan REDIS_URL
npm run dev               # node --watch server.js
```

### Frontend:
```bash
npm install
npm run dev               # http://localhost:5173
```

---

## Socket.IO Events

| Event (Client → Server) | Payload | Keterangan |
|---|---|---|
| `create-room` | `{ playerName, maxQuestions }` | Host buat room |
| `join-room` | `{ code, playerName, sessionToken? }` | Pemain join |
| `start-game` | `{}` | Host mulai game |
| `submit-answer` | `{ chosenIdx }` | Kirim jawaban |
| `leave-room` | `{}` | Keluar room |

| Event (Server → Client) | Payload | Keterangan |
|---|---|---|
| `game-started` | `{ totalQuestions, gameId }` | Game dimulai |
| `question-start` | `{ no, total, question, duration, serverTime }` | Soal baru |
| `timer-tick` | `{ remaining }` | Update countdown |
| `answer-result` | `{ isCorrect, points, rank, correctIdx }` | Feedback personal |
| `question-end` | `{ correctIdx, fastestCorrect, leaderboard }` | Soal selesai |
| `leaderboard-update` | `{ leaderboard }` | Update LB |
| `game-finished` | `{ leaderboard, gameId }` | Game selesai |
| `player-joined` | `{ player }` | Pemain baru join |
| `player-left` | `{ playerId, playerName }` | Pemain keluar |
| `host-changed` | `{ newHostId, newHostName }` | Host berganti |

---

## Sistem Poin

| Ranking Jawaban Benar | Poin |
|---|---|
| #1 Tercepat | 100 |
| #2 Tercepat | 75 |
| #3 Tercepat | 50 |
| #4+ | 25 |
| Salah | 0 |

---

## Anti-Cheat

Semua logika di server:
- ✅ Timer dikontrol server (bukan client)
- ✅ Jawaban benar tidak dikirim ke client (hanya setelah soal tutup)
- ✅ Skor dihitung di server
- ✅ Urutan soal ditentukan server
- ✅ Rate limiting via express-rate-limit
- ✅ Reconnect window 30 detik via Redis TTL

---

## Kapasitas

- **Per room**: 50 pemain aktif + unlimited spectator
- **Concurrent rooms**: 100+ (dibatasi RAM Railway tier)
- **WebSocket connections**: 5.000+ dengan Redis adapter horizontal scaling
- **Soal**: Ambil dari PostgreSQL, tidak ada cache soal di client
