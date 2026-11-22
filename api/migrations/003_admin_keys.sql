-- Milestone 3: admin keys, key rotation with a grace period, and an audit log.

-- A third scope for key management. Admin keys are created only with the create-key CLI.
ALTER TABLE api_keys DROP CONSTRAINT api_keys_scope_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_scope_check CHECK (scope IN ('ingest', 'read', 'admin'));

-- When set, the key stops working at this time (see "usable" in src/repo/keys.ts). Rotating
-- sets it on the old key, so both keys work during the grace period.
ALTER TABLE api_keys ADD COLUMN expires_at timestamptz;

-- With a grace period there can be two usable keys per game and scope, so the old "one active
-- key" index goes. "At most two" depends on the clock (expires_at > now()), which an index can't
-- express; it's enforced inside the rotate transaction instead, under a lock on the game's row.
DROP INDEX one_active_key_per_game_scope;
CREATE INDEX api_keys_game_scope ON api_keys (game_id, scope, created_at DESC);

-- Admin keys are never rotated with a grace period, so exactly one is ever usable. This one the
-- database can check: the current admin key is the one that is neither revoked nor expiring.
CREATE UNIQUE INDEX one_admin_key_per_game
  ON api_keys (game_id) WHERE scope = 'admin' AND revoked_at IS NULL AND expires_at IS NULL;

-- Every key-management action, written in the same transaction as the action itself.
-- actor_key_id is the admin key that did it (NULL for the create-key CLI).
CREATE TABLE admin_audit (
  id            bigserial PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  game_id       uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  actor_key_id  uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  action        text NOT NULL CHECK (action IN ('rotate', 'revoke')),
  target_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  detail        jsonb
);
-- The audit list: one game's rows, newest first, keyset-paged by id.
CREATE INDEX admin_audit_game ON admin_audit (game_id, id DESC);

-- Ingestion screen: a game's refused requests over time (joined through its keys), and its
-- accepted events by arrival time rather than by the event's own timestamp.
CREATE INDEX rejected_key_time ON rejected_requests (api_key_id, received_at DESC);
CREATE INDEX events_game_received ON events (game_id, received_at DESC);
