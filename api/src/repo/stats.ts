/*
  Read queries for the dashboard. Every query is scoped to one game and, except the
  violations list, to the last 24 hours.
*/
import type { Db } from "../db/pool.js";

const LAST_24H = "occurred_at >= now() - interval '24 hours'";

export interface Summary {
  total: number;
  enforced: number;
  shadowed: number;
  uniquePlayers: number;
  uniqueServers: number;
  lastEventAt: string | null;
  byRule: { rule: string; count: number }[];
}

export async function summary(db: Db, gameId: string): Promise<Summary> {
  const [totals, byRule] = await Promise.all([
    db.query(
      `SELECT count(*)                                 AS total,
              count(*) FILTER (WHERE mode = 'enforce') AS enforced,
              count(*) FILTER (WHERE mode = 'shadow')  AS shadowed,
              count(DISTINCT player_id)                AS "uniquePlayers",
              count(DISTINCT server_id)                AS "uniqueServers",
              max(occurred_at)                         AS "lastEventAt"
       FROM events WHERE game_id = $1 AND ${LAST_24H}`,
      [gameId],
    ),
    db.query(
      `SELECT rule, count(*) AS count FROM events
       WHERE game_id = $1 AND ${LAST_24H}
       GROUP BY rule ORDER BY count DESC, rule`,
      [gameId],
    ),
  ]);
  const row = totals.rows[0];
  return { ...row, lastEventAt: row.lastEventAt?.toISOString() ?? null, byRule: byRule.rows };
}

export interface HourBucket {
  hour: string;
  shadow: number;
  enforce: number;
}

// Always 24 buckets (oldest first); generate_series makes empty hours show up as zeros.
export async function hourly(db: Db, gameId: string): Promise<HourBucket[]> {
  const { rows } = await db.query(
    `SELECT h.hour,
            count(e.id) FILTER (WHERE e.mode = 'shadow')  AS shadow,
            count(e.id) FILTER (WHERE e.mode = 'enforce') AS enforce
     FROM generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()), interval '1 hour') AS h(hour)
     LEFT JOIN events e
       ON e.game_id = $1 AND e.occurred_at >= h.hour AND e.occurred_at < h.hour + interval '1 hour'
     GROUP BY h.hour ORDER BY h.hour`,
    [gameId],
  );
  return rows.map((r) => ({ hour: r.hour.toISOString(), shadow: r.shadow, enforce: r.enforce }));
}

export async function topRemotes(db: Db, gameId: string, limit: number) {
  const { rows } = await db.query<{ remote: string; count: number }>(
    `SELECT remote, count(*) AS count FROM events
     WHERE game_id = $1 AND ${LAST_24H}
     GROUP BY remote ORDER BY count DESC, remote LIMIT $2`,
    [gameId, limit],
  );
  return rows;
}

export interface Violation {
  id: number;
  occurredAt: string;
  serverId: string;
  playerId: number;
  playerName: string;
  remote: string;
  rule: string;
  detail: string;
  mode: "shadow" | "enforce";
}

export interface Cursor {
  occurredAt: string;
  id: number;
}

// Keyset pagination: "give me rows older than the last one I saw", using the
// (occurred_at, id) index. Unlike OFFSET, it stays fast and stable while new rows arrive.
export async function listViolations(
  db: Db,
  gameId: string,
  opts: { rule?: string; playerId?: number; remote?: string; limit: number; cursor?: Cursor },
): Promise<{ items: Violation[]; next: Cursor | null }> {
  // Unused filters are passed as NULL and switch themselves off. node-pg plans each query with
  // its real values, so Postgres can still pick the player or remote index when one is set.
  const { rows } = await db.query(
    `SELECT id, occurred_at AS "occurredAt", server_id AS "serverId", player_id AS "playerId",
            player_name AS "playerName", remote, rule, detail, mode
     FROM events
     WHERE game_id = $1
       AND ($2::text IS NULL OR rule = $2)
       AND ($6::bigint IS NULL OR player_id = $6)
       AND ($7::text IS NULL OR remote = $7)
       AND ($3::timestamptz IS NULL OR (occurred_at, id) < ($3, $4::bigint))
     ORDER BY occurred_at DESC, id DESC
     LIMIT $5`,
    [
      gameId,
      opts.rule ?? null,
      opts.cursor?.occurredAt ?? null,
      opts.cursor?.id ?? null,
      opts.limit + 1,
      opts.playerId ?? null,
      opts.remote ?? null,
    ],
  );
  // Fetching one extra row tells us whether another page exists without a COUNT query.
  const hasMore = rows.length > opts.limit;
  const items: Violation[] = rows.slice(0, opts.limit).map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() }));
  const last = items.at(-1);
  return { items, next: hasMore && last ? { occurredAt: last.occurredAt, id: last.id } : null };
}
