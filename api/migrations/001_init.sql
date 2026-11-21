-- One row per Roblox experience (universe) that reports to Oculus.
CREATE TABLE games (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  universe_id bigint UNIQUE NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Keys are stored as sha256(raw key). The raw key is shown once at creation and never stored.
-- scope: 'ingest' keys are for game servers (POST), 'read' keys are for the dashboard (GET).
CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id      uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  key_hash     bytea UNIQUE NOT NULL,
  key_prefix   text NOT NULL,
  scope        text NOT NULL CHECK (scope IN ('ingest', 'read')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
-- At most one active key per game and scope; rotating revokes the old one first.
CREATE UNIQUE INDEX one_active_key_per_game_scope
  ON api_keys (game_id, scope) WHERE revoked_at IS NULL;

CREATE TABLE events (
  id          bigserial PRIMARY KEY,
  game_id     uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  api_key_id  uuid NOT NULL REFERENCES api_keys(id),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  server_id   text NOT NULL,
  player_id   bigint NOT NULL,
  player_name text NOT NULL,
  remote      text NOT NULL,
  rule        text NOT NULL,
  detail      text NOT NULL,
  mode        text NOT NULL CHECK (mode IN ('shadow', 'enforce'))
);
-- Time-ordered reads (charts, feed, keyset pagination), optionally filtered by rule.
CREATE INDEX events_game_time   ON events (game_id, occurred_at DESC, id DESC);
CREATE INDEX events_game_rule   ON events (game_id, rule, occurred_at DESC, id DESC);
CREATE INDEX events_game_remote ON events (game_id, remote);

-- Every request the API refused, and why. api_key_id is null when the key itself was bad.
CREATE TABLE rejected_requests (
  id          bigserial PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now(),
  reason      text NOT NULL CHECK (reason IN ('bad_key', 'invalid_schema', 'rate_limited', 'too_large')),
  api_key_id  uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  ip          inet,
  route       text NOT NULL,
  detail      jsonb
);
CREATE INDEX rejected_time ON rejected_requests (received_at DESC);
