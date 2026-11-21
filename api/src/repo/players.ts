/*
  Player queries for the Players screen and drawer. Every query is scoped to one game and to
  the requested time window (see lib/windows.ts).
*/
import type { Querier } from "../db/pool.js";
import type { TimeWindow } from "../lib/windows.js";
import { bucketCounts, type Bucket } from "./buckets.js";

export type PlayerSort = "total" | "enforced" | "lastSeen";

export interface PlayerRow {
  playerId: number;
  playerName: string;
  total: number;
  enforced: number;
  shadowed: number;
  rules: string[];
  remotes: number;
  firstSeen: string;
  lastSeen: string;
}

// The sort param picks one of these; it never becomes SQL itself. "playerId" breaks ties so
// rows with equal counts keep the same order from one page to the next.
const ORDER_BY: Record<PlayerSort, string> = {
  total: `total DESC, "playerId"`,
  enforced: `enforced DESC, total DESC, "playerId"`,
  lastSeen: `"lastSeen" DESC, "playerId"`,
};

// `q` is an exact player id when it is all digits, otherwise a case-insensitive name prefix.
// LIKE treats % and _ as wildcards (and \ as the escape), so those are escaped to match literally.
function parseSearch(q: string | undefined): { playerId: number | null; namePrefix: string | null } {
  if (!q) return { playerId: null, namePrefix: null };
  if (/^\d+$/.test(q) && Number(q) <= Number.MAX_SAFE_INTEGER) return { playerId: Number(q), namePrefix: null };
  return { playerId: null, namePrefix: q.replace(/[\\%_]/g, "\\$&") + "%" };
}

/*
  One row per player. Offset paging, not keyset: the sort keys are aggregates computed by this
  query, so no index can seek to "after the last row", and they change between requests anyway.
  The offset cap (schemas/queries.ts) bounds the cost.

  Two queries, both on the caller's snapshot (see withSnapshot), so they agree:
    1. The page. Every player in the window has to be aggregated to sort them, so this pass uses
       only aggregates Postgres can compute in one hashed pass (counts, min, max, bool_or).
       The latest name, distinct rules and distinct remotes would each force a sort of every
       event instead, and only the page's players need them.
    2. Those details for just the page's players. Their events are first collapsed to distinct
       (remote, rule) combinations, which is a cheap hash, so the DISTINCT aggregates then run
       over a few hundred rows per player instead of every event.
  (As one query with the page as a CTE, Postgres can't tell the page is small and plans step 2
  for every player, which is slower.)
*/
export async function listPlayers(
  db: Querier,
  gameId: string,
  w: TimeWindow,
  opts: { sort: PlayerSort; q?: string; limit: number; offset: number },
): Promise<{ items: PlayerRow[]; hasMore: boolean }> {
  const search = parseSearch(opts.q);
  const page = await db.query(
    `SELECT player_id                                AS "playerId",
            count(*)                                 AS total,
            count(*) FILTER (WHERE mode = 'enforce') AS enforced,
            count(*) FILTER (WHERE mode = 'shadow')  AS shadowed,
            min(occurred_at)                         AS "firstSeen",
            max(occurred_at)                         AS "lastSeen"
     FROM events
     WHERE game_id = $1 AND occurred_at >= $2
       AND ($3::bigint IS NULL OR player_id = $3)
     GROUP BY player_id
     -- Name search runs after grouping: a player matches if any name they used in the window
     -- matches, and their counts still include every event (not just the matching-name ones).
     HAVING ($4::text IS NULL OR bool_or(player_name ILIKE $4 ESCAPE '\\'))
     ORDER BY ${ORDER_BY[opts.sort]}
     LIMIT $5 OFFSET $6`,
    [gameId, w.start, search.playerId, search.namePrefix, opts.limit + 1, opts.offset],
  );
  // One extra row tells us whether another page exists, without a COUNT query.
  const hasMore = page.rows.length > opts.limit;
  const rows = page.rows.slice(0, opts.limit);
  if (rows.length === 0) return { items: [], hasMore };

  const details = await db.query<{ playerId: number; playerName: string; rules: string[]; remotes: number }>(
    `SELECT c.player_id AS "playerId", latest.player_name AS "playerName", c.rules, c.remotes
     FROM (
       SELECT player_id, array_agg(DISTINCT rule ORDER BY rule) AS rules, count(DISTINCT remote) AS remotes
       FROM (
         SELECT player_id, remote, rule FROM events
         WHERE game_id = $1 AND occurred_at >= $2 AND player_id = ANY($3::bigint[])
         GROUP BY player_id, remote, rule
       ) combos
       GROUP BY player_id
     ) c
     -- The name of their newest event in the window, read from the (game_id, player_id,
     -- occurred_at DESC) index.
     CROSS JOIN LATERAL (
       SELECT player_name FROM events
       WHERE game_id = $1 AND player_id = c.player_id AND occurred_at >= $2
       ORDER BY occurred_at DESC, id DESC
       LIMIT 1
     ) latest`,
    [gameId, w.start, rows.map((r) => r.playerId)],
  );
  const byId = new Map(details.rows.map((d) => [d.playerId, d]));

  const items: PlayerRow[] = rows.map((r) => {
    const d = byId.get(r.playerId)!;
    return {
      playerId: r.playerId,
      playerName: d.playerName,
      total: r.total,
      enforced: r.enforced,
      shadowed: r.shadowed,
      rules: d.rules,
      remotes: d.remotes,
      firstSeen: r.firstSeen.toISOString(),
      lastSeen: r.lastSeen.toISOString(),
    };
  });
  return { items, hasMore };
}

export interface PlayerDetail {
  player: {
    playerId: number;
    playerName: string;
    total: number;
    enforced: number;
    shadowed: number;
    servers: number;
    firstSeen: string | null;
    lastSeen: string | null;
  };
  byRule: { rule: string; count: number }[];
  byRemote: { remote: string; count: number }[];
  buckets: Bucket[];
}

// null when the player has never had an event in this game (the route answers 404).
// A player seen before, but not in this window, gets zeros.
export async function getPlayer(db: Querier, gameId: string, playerId: number, w: TimeWindow): Promise<PlayerDetail | null> {
  const latest = await db.query<{ playerName: string }>(
    `SELECT player_name AS "playerName" FROM events
     WHERE game_id = $1 AND player_id = $2
     ORDER BY occurred_at DESC, id DESC LIMIT 1`,
    [gameId, playerId],
  );
  const playerName = latest.rows[0]?.playerName;
  if (playerName === undefined) return null;

  const scope = `game_id = $1 AND player_id = $2 AND occurred_at >= $3`;
  const params = [gameId, playerId, w.start];
  const [totals, byRule, byRemote, buckets] = await Promise.all([
    db.query(
      `SELECT count(*)                                 AS total,
              count(*) FILTER (WHERE mode = 'enforce') AS enforced,
              count(*) FILTER (WHERE mode = 'shadow')  AS shadowed,
              count(DISTINCT server_id)                AS servers,
              min(occurred_at)                         AS "firstSeen",
              max(occurred_at)                         AS "lastSeen"
       FROM events WHERE ${scope}`,
      params,
    ),
    db.query(`SELECT rule, count(*) AS count FROM events WHERE ${scope} GROUP BY rule ORDER BY count DESC, rule`, params),
    db.query(
      `SELECT remote, count(*) AS count FROM events WHERE ${scope} GROUP BY remote ORDER BY count DESC, remote`,
      params,
    ),
    bucketCounts(db, gameId, w, { playerId }),
  ]);

  const t = totals.rows[0];
  return {
    player: {
      playerId,
      playerName,
      total: t.total,
      enforced: t.enforced,
      shadowed: t.shadowed,
      servers: t.servers,
      firstSeen: t.firstSeen?.toISOString() ?? null,
      lastSeen: t.lastSeen?.toISOString() ?? null,
    },
    byRule: byRule.rows,
    byRemote: byRemote.rows,
    buckets,
  };
}
