/*
  Remote queries for the Remotes screen and drawer. Every query is scoped to one game and to
  the requested time window (see lib/windows.ts).
*/
import type { Db } from "../db/pool.js";
import type { TimeWindow } from "../lib/windows.js";
import { bucketCounts, bucketCountsByRemote, type Bucket } from "./buckets.js";
import type { Violation } from "./stats.js";

type Mode = Violation["mode"];
type RuleCount = { rule: string; count: number };

export type RemoteSort = "total" | "enforced" | "uniquePlayers";

// Remote names are whatever game servers send, so a compromised server could invent thousands.
// The list has no paging; this keeps its response bounded.
export const MAX_REMOTES = 200;

export interface RemoteRow {
  remote: string;
  total: number;
  enforced: number;
  shadowed: number;
  uniquePlayers: number;
  byRule: RuleCount[];
  lastSeen: string;
  mode: Mode;
  buckets: Bucket[];
}

// Picked by the sort param, never built from it. remote breaks ties.
const ORDER_BY: Record<RemoteSort, string> = {
  total: `total DESC, remote`,
  enforced: `enforced DESC, total DESC, remote`,
  uniquePlayers: `"uniquePlayers" DESC, total DESC, remote`,
};

export async function listRemotes(db: Db, gameId: string, w: TimeWindow, sort: RemoteSort): Promise<RemoteRow[]> {
  // 1. One row per remote. "mode" is the mode of its newest event, which is also its newest
  //    event overall (the window has no upper end), so the drawer always agrees with the list.
  const { rows } = await db.query(
    `SELECT remote,
            count(*)                                                AS total,
            count(*) FILTER (WHERE mode = 'enforce')                AS enforced,
            count(*) FILTER (WHERE mode = 'shadow')                 AS shadowed,
            count(DISTINCT player_id)                               AS "uniquePlayers",
            max(occurred_at)                                        AS "lastSeen",
            (array_agg(mode ORDER BY occurred_at DESC, id DESC))[1] AS mode
     FROM events
     WHERE game_id = $1 AND occurred_at >= $2
     GROUP BY remote
     ORDER BY ${ORDER_BY[sort]}
     LIMIT $3`,
    [gameId, w.start, MAX_REMOTES],
  );
  if (rows.length === 0) return [];

  // 2 + 3. Rule breakdowns and sparklines for just those remotes: two grouped queries, rather
  //        than a subquery per remote that would rescan the window up to 200 times.
  const names: string[] = rows.map((r) => r.remote);
  const [rules, buckets] = await Promise.all([
    db.query<{ remote: string; rule: string; count: number }>(
      `SELECT remote, rule, count(*) AS count FROM events
       WHERE game_id = $1 AND occurred_at >= $2 AND remote = ANY($3)
       GROUP BY remote, rule
       ORDER BY count DESC, rule`,
      [gameId, w.start, names],
    ),
    bucketCountsByRemote(db, gameId, w, names),
  ]);
  const rulesByRemote = new Map<string, RuleCount[]>(names.map((name) => [name, []]));
  for (const r of rules.rows) rulesByRemote.get(r.remote)!.push({ rule: r.rule, count: r.count });

  return rows.map((r) => ({
    remote: r.remote,
    total: r.total,
    enforced: r.enforced,
    shadowed: r.shadowed,
    uniquePlayers: r.uniquePlayers,
    byRule: rulesByRemote.get(r.remote)!,
    lastSeen: r.lastSeen.toISOString(),
    mode: r.mode,
    buckets: buckets.get(r.remote)!,
  }));
}

export interface RemoteDetail {
  remote: {
    remote: string;
    total: number;
    enforced: number;
    shadowed: number;
    uniquePlayers: number;
    lastSeen: string | null;
    mode: Mode;
  };
  byRule: RuleCount[];
  topPlayers: { playerId: number; playerName: string; total: number; enforced: number }[];
  buckets: Bucket[];
}

// null when the remote has never had an event in this game (the route answers 404).
// A remote seen before, but not in this window, gets zeros (and its current mode).
export async function getRemote(db: Db, gameId: string, remote: string, w: TimeWindow): Promise<RemoteDetail | null> {
  const newest = await db.query<{ mode: Mode }>(
    `SELECT mode FROM events WHERE game_id = $1 AND remote = $2 ORDER BY occurred_at DESC, id DESC LIMIT 1`,
    [gameId, remote],
  );
  const mode = newest.rows[0]?.mode;
  if (mode === undefined) return null;

  const scope = `game_id = $1 AND remote = $2 AND occurred_at >= $3`;
  const params = [gameId, remote, w.start];
  const [totals, byRule, topPlayers, buckets] = await Promise.all([
    db.query(
      `SELECT count(*)                                 AS total,
              count(*) FILTER (WHERE mode = 'enforce') AS enforced,
              count(*) FILTER (WHERE mode = 'shadow')  AS shadowed,
              count(DISTINCT player_id)                AS "uniquePlayers",
              max(occurred_at)                         AS "lastSeen"
       FROM events WHERE ${scope}`,
      params,
    ),
    db.query(`SELECT rule, count(*) AS count FROM events WHERE ${scope} GROUP BY rule ORDER BY count DESC, rule`, params),
    db.query(
      `SELECT player_id                                                      AS "playerId",
              (array_agg(player_name ORDER BY occurred_at DESC, id DESC))[1] AS "playerName",
              count(*)                                                       AS total,
              count(*) FILTER (WHERE mode = 'enforce')                       AS enforced
       FROM events WHERE ${scope}
       GROUP BY player_id
       ORDER BY total DESC, "playerId"
       LIMIT 10`,
      params,
    ),
    bucketCounts(db, gameId, w, { remote }),
  ]);

  const t = totals.rows[0];
  return {
    remote: {
      remote,
      total: t.total,
      enforced: t.enforced,
      shadowed: t.shadowed,
      uniquePlayers: t.uniquePlayers,
      lastSeen: t.lastSeen?.toISOString() ?? null,
      mode,
    },
    byRule: byRule.rows,
    topPlayers: topPlayers.rows,
    buckets,
  };
}
