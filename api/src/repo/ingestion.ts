/*
  Ingestion health for one game: what arrived, what was refused, and which servers are sending.
  Everything here is by *arrival* time (received_at), not the event's own timestamp, because the
  question is "is ingest working right now", not "when did the violation happen".
*/
import type { Querier } from "../db/pool.js";
import { REJECT_REASONS, type RejectReason } from "../lib/rejection.js";
import type { TimeWindow } from "../lib/windows.js";
import { bucketParams, bucketSql } from "./buckets.js";

export type ReasonCounts = Record<RejectReason, number>;

export interface IngestionBucket {
  start: string;
  accepted: number; // events stored
  rejected: number; // requests refused (a refused request may have carried up to 100 events)
  byReason: ReasonCounts;
}

export interface IngestionOverview {
  buckets: IngestionBucket[];
  totals: { accepted: number; rejected: number; byReason: ReasonCounts };
  // Requests with a key that matched nothing (or no key at all) can't be tied to any game, so
  // they're counted across every game on this server, separately from the numbers above.
  unattributedBadKey: { count: number; scope: "all_games" };
}

const zeroReasons = (): ReasonCounts => Object.fromEntries(REJECT_REASONS.map((r) => [r, 0])) as ReasonCounts;

export async function ingestionOverview(db: Querier, gameId: string, w: TimeWindow): Promise<IngestionOverview> {
  const b = bucketSql(1);
  const params = [...bucketParams(w), gameId];
  const [accepted, rejected, unattributed] = await Promise.all([
    db.query<{ start: Date; accepted: number }>(
      `SELECT s.start, coalesce(c.n, 0) AS accepted
       FROM (${b.series}) s
       LEFT JOIN (
         SELECT ${b.bucketOf("received_at")} AS i, count(*) AS n
         FROM events WHERE game_id = $4 AND received_at >= $1
         GROUP BY 1
       ) c USING (i)
       ORDER BY s.i`,
      params,
    ),
    // Refusals count for this game when the request used one of its keys: wrong scope, bad
    // payload, rate limited, too large, or a key of its that was expired or revoked.
    db.query<{ i: number; reason: RejectReason; n: number }>(
      `SELECT ${b.bucketOf("r.received_at")} AS i, r.reason, count(*) AS n
       FROM rejected_requests r
       JOIN api_keys k ON k.id = r.api_key_id
       WHERE k.game_id = $4 AND r.received_at >= $1
       GROUP BY 1, 2`,
      params,
    ),
    db.query<{ n: number }>(
      `SELECT count(*) AS n FROM rejected_requests
       WHERE api_key_id IS NULL AND reason = 'bad_key' AND received_at >= $1`,
      [w.start],
    ),
  ]);

  const buckets: IngestionBucket[] = accepted.rows.map((r) => ({
    start: r.start.toISOString(),
    accepted: r.accepted,
    rejected: 0,
    byReason: zeroReasons(),
  }));
  const totals = { accepted: 0, rejected: 0, byReason: zeroReasons() };
  for (const r of rejected.rows) {
    const bucket = buckets[r.i]!;
    bucket.byReason[r.reason] += r.n;
    bucket.rejected += r.n;
    totals.byReason[r.reason] += r.n;
    totals.rejected += r.n;
  }
  for (const bucket of buckets) totals.accepted += bucket.accepted;

  return { buckets, totals, unattributedBadKey: { count: unattributed.rows[0]!.n, scope: "all_games" } };
}

export const SILENT_AFTER_MINUTES = 10;
export const MAX_SERVERS = 200;

export interface ServerRow {
  serverId: string;
  events: number;
  firstReceived: string;
  lastReceived: string;
  // No event received for SILENT_AFTER_MINUTES. The Luau client only sends when there are
  // violations to report, so a quiet server may be healthy, or may have shut down.
  silent: boolean;
}

// Servers that sent events in the window, most recently heard from first.
export async function ingestionServers(
  db: Querier,
  gameId: string,
  w: TimeWindow,
): Promise<{ items: ServerRow[]; truncated: boolean }> {
  const { rows } = await db.query(
    `SELECT server_id AS "serverId", count(*) AS events,
            min(received_at) AS "firstReceived", max(received_at) AS "lastReceived",
            max(received_at) < $3::timestamptz - $4::int * interval '1 minute' AS silent
     FROM events
     WHERE game_id = $1 AND received_at >= $2
     GROUP BY server_id
     ORDER BY "lastReceived" DESC, server_id
     LIMIT $5`,
    [gameId, w.start, w.asOf, SILENT_AFTER_MINUTES, MAX_SERVERS + 1],
  );
  const items = rows.slice(0, MAX_SERVERS).map((r) => ({
    ...r,
    firstReceived: r.firstReceived.toISOString(),
    lastReceived: r.lastReceived.toISOString(),
  }));
  return { items, truncated: rows.length > MAX_SERVERS };
}
