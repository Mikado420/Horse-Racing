-- オンライン競走馬オーナーズ MVP スキーマ（何度実行しても安全）

CREATE TABLE IF NOT EXISTS players (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text        NOT NULL,
  password_hash text        NOT NULL,
  money         bigint      NOT NULL CHECK (money >= 0),
  total_prize   bigint      NOT NULL DEFAULT 0,
  races         integer     NOT NULL DEFAULT 0,
  wins          integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS players_username_lower ON players (lower(username));

CREATE TABLE IF NOT EXISTS horses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid        NOT NULL REFERENCES players(id),
  name              text        NOT NULL,
  template          text        NOT NULL,
  stats             jsonb       NOT NULL,
  potential         jsonb       NOT NULL,
  style             text        NOT NULL,
  aptitude          jsonb       NOT NULL,
  fatigue           integer     NOT NULL DEFAULT 0 CHECK (fatigue BETWEEN 0 AND 100),
  condition         integer     NOT NULL DEFAULT 0 CHECK (condition BETWEEN -2 AND 2),
  injury_rests_left integer     NOT NULL DEFAULT 0 CHECK (injury_rests_left >= 0),
  races             integer     NOT NULL DEFAULT 0,
  wins              integer     NOT NULL DEFAULT 0,
  total_prize       bigint      NOT NULL DEFAULT 0,
  retired           boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS horses_owner ON horses (owner_id);
-- v0.2: 競走生活のターン数
ALTER TABLE horses ADD COLUMN IF NOT EXISTS turns integer NOT NULL DEFAULT 0;

-- 確定したレース。id はロビー生成時に決まり、主キー制約で「同じレースの二重精算」を防ぐ
CREATE TABLE IF NOT EXISTS races (
  id          uuid PRIMARY KEY,
  course_id   text        NOT NULL,
  course_name text        NOT NULL,
  distance    integer     NOT NULL,
  surface     text        NOT NULL,
  going       text        NOT NULL,
  weather     text        NOT NULL,
  seed        bigint      NOT NULL,
  field_size  integer     NOT NULL,
  purse       bigint      NOT NULL,
  replay      jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS races_created ON races (created_at DESC);

CREATE TABLE IF NOT EXISTS race_entries (
  race_id        uuid    NOT NULL REFERENCES races(id),
  horse_id       uuid    NOT NULL REFERENCES horses(id),
  player_id      uuid    NOT NULL REFERENCES players(id),
  gate           integer NOT NULL,
  position       integer NOT NULL,
  time_ms        integer NOT NULL,
  margin_lengths real    NOT NULL,
  prize          bigint  NOT NULL,
  horse_name     text    NOT NULL,
  player_name    text    NOT NULL,
  PRIMARY KEY (race_id, horse_id),
  UNIQUE (race_id, gate),
  UNIQUE (race_id, position)
);
CREATE INDEX IF NOT EXISTS race_entries_horse ON race_entries (horse_id);
CREATE INDEX IF NOT EXISTS race_entries_player ON race_entries (player_id);
