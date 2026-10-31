-- The CHECK on energy is what refuses a continue the player can't afford: the spend runs in one batch with the
-- continue row, so a failed check rolls both back.
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  energy INTEGER NOT NULL DEFAULT 0 CHECK (energy >= 0),
  created INTEGER NOT NULL
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  created INTEGER NOT NULL
);

CREATE TABLE device_ips (
  ip TEXT NOT NULL,
  day INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (ip, day)
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  player TEXT NOT NULL,
  started INTEGER NOT NULL,
  walls INTEGER NOT NULL DEFAULT 0,
  perfects INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX runs_open ON runs (player) WHERE closed = 0;

-- One row per continue. The key stops the same continue from being charged twice, and the index allows one ad per run.
CREATE TABLE continues (
  run TEXT NOT NULL,
  n INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('energy', 'ad')),
  cost INTEGER NOT NULL,
  PRIMARY KEY (run, n)
);

CREATE UNIQUE INDEX one_ad_per_run ON continues (run) WHERE method = 'ad';
