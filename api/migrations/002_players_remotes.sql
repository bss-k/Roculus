-- Milestone 2: player and remote drill-downs.
-- Both indexes keep each player's (or remote's) events together, newest first, so
-- "this player's events in the window" and timelines (keyset paging on occurred_at, id) read
-- one contiguous slice of the index instead of scanning and sorting.
CREATE INDEX events_game_player ON events (game_id, player_id, occurred_at DESC, id DESC);

-- The old (game_id, remote) index could find a remote's rows but not walk them in time order.
DROP INDEX events_game_remote;
CREATE INDEX events_game_remote ON events (game_id, remote, occurred_at DESC, id DESC);
