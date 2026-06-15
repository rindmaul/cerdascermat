-- ============================================================
-- CerdasCermat Multiplayer - PostgreSQL Schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Players ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS players (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_name  VARCHAR(50) NOT NULL,
  session_token VARCHAR(128) UNIQUE NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Rooms ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rooms (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code          VARCHAR(8) UNIQUE NOT NULL,
  host_id       UUID REFERENCES players(id),
  max_questions INTEGER NOT NULL DEFAULT 100,
  status        VARCHAR(20) NOT NULL DEFAULT 'waiting'
                CHECK (status IN ('waiting','playing','finished')),
  max_players   INTEGER NOT NULL DEFAULT 50,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ
);

CREATE INDEX idx_rooms_code   ON rooms(code);
CREATE INDEX idx_rooms_status ON rooms(status);

-- ── Games ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS games (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id         UUID NOT NULL REFERENCES rooms(id),
  total_questions INTEGER NOT NULL,
  current_question INTEGER DEFAULT 0,
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);

-- ── Game Participants ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_participants (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id       UUID NOT NULL REFERENCES games(id),
  player_id     UUID NOT NULL REFERENCES players(id),
  display_name  VARCHAR(50) NOT NULL,
  total_score   INTEGER DEFAULT 0,
  correct_count INTEGER DEFAULT 0,
  wrong_count   INTEGER DEFAULT 0,
  total_time_ms BIGINT DEFAULT 0,
  is_spectator  BOOLEAN DEFAULT FALSE,
  final_rank    INTEGER,
  joined_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(game_id, player_id)
);

CREATE INDEX idx_gp_game_id ON game_participants(game_id);
CREATE INDEX idx_gp_player_id ON game_participants(player_id);

-- ── Questions Bank ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS questions (
  id          SERIAL PRIMARY KEY,
  category    VARCHAR(10) NOT NULL,
  type        VARCHAR(5) NOT NULL CHECK (type IN ('mc','tf')),
  question    TEXT NOT NULL,
  options     JSONB,            -- array of strings for mc, null for tf
  answer_idx  INTEGER NOT NULL, -- 0-3 for mc, 0=true/1=false for tf
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_questions_category ON questions(category);
CREATE INDEX idx_questions_type ON questions(type);

-- ── Game Questions (questions used in a game) ─────────────────
CREATE TABLE IF NOT EXISTS game_questions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id       UUID NOT NULL REFERENCES games(id),
  question_id   INTEGER NOT NULL REFERENCES questions(id),
  question_no   INTEGER NOT NULL,  -- order in this game
  shown_at      TIMESTAMPTZ,
  closed_at     TIMESTAMPTZ,
  UNIQUE(game_id, question_no)
);

CREATE INDEX idx_gq_game_id ON game_questions(game_id);

-- ── Answers ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS answers (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_question_id  UUID NOT NULL REFERENCES game_questions(id),
  participant_id    UUID NOT NULL REFERENCES game_participants(id),
  chosen_idx        INTEGER NOT NULL,
  is_correct        BOOLEAN NOT NULL,
  response_time_ms  INTEGER NOT NULL,  -- ms from question shown
  speed_rank        INTEGER,           -- 1=fastest correct, etc
  points_earned     INTEGER DEFAULT 0,
  answered_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(game_question_id, participant_id)
);

CREATE INDEX idx_answers_gq_id ON answers(game_question_id);
CREATE INDEX idx_answers_participant_id ON answers(participant_id);

-- ── Player Stats (aggregate) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS player_stats (
  player_id        UUID PRIMARY KEY REFERENCES players(id),
  games_played     INTEGER DEFAULT 0,
  games_won        INTEGER DEFAULT 0,
  total_points     BIGINT DEFAULT 0,
  total_correct    INTEGER DEFAULT 0,
  total_answered   INTEGER DEFAULT 0,
  total_time_ms    BIGINT DEFAULT 0,
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Triggers: update player stats on game finish ──────────────
CREATE OR REPLACE FUNCTION update_player_stats()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO player_stats (player_id, games_played, games_won, total_points, total_correct, total_answered, total_time_ms)
  VALUES (NEW.player_id, 1,
    CASE WHEN NEW.final_rank = 1 THEN 1 ELSE 0 END,
    NEW.total_score, NEW.correct_count,
    NEW.correct_count + NEW.wrong_count, NEW.total_time_ms)
  ON CONFLICT (player_id) DO UPDATE SET
    games_played   = player_stats.games_played + 1,
    games_won      = player_stats.games_won + CASE WHEN NEW.final_rank = 1 THEN 1 ELSE 0 END,
    total_points   = player_stats.total_points + NEW.total_score,
    total_correct  = player_stats.total_correct + NEW.correct_count,
    total_answered = player_stats.total_answered + NEW.correct_count + NEW.wrong_count,
    total_time_ms  = player_stats.total_time_ms + NEW.total_time_ms,
    updated_at     = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_player_stats
AFTER UPDATE OF final_rank ON game_participants
FOR EACH ROW
WHEN (NEW.final_rank IS NOT NULL AND OLD.final_rank IS NULL)
EXECUTE FUNCTION update_player_stats();
