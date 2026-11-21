/*
  SQL building blocks for rolling time buckets (see lib/windows.ts). The window is passed as
  three query parameters; the caller says which $n they start at, so the pieces slot into any
  query without string-building user input:

    $p     window start      (timestamptz)
    $p+1   bucket size       (seconds)
    $p+2   number of buckets
*/
import type { Querier } from "../db/pool.js";
import type { TimeWindow } from "../lib/windows.js";

export function bucketParams(w: TimeWindow): [Date, number, number] {
  return [w.start, w.bucketSeconds, w.buckets];
}

export function bucketSql(p: number) {
  const start = `$${p}::timestamptz`;
  const size = `$${p + 1}::int`;
  const count = `$${p + 2}::int`;
  return {
    // One row per bucket, oldest first: (i, start). LEFT JOIN counts onto it so empty buckets
    // come back as zeros instead of missing rows.
    series: `SELECT i, ${start} + i * ${size} * interval '1 second' AS start FROM generate_series(0, ${count} - 1) AS i`,

    // The bucket number an event falls in: whole bucket-sizes elapsed since the window start.
    // Only meaningful for rows already filtered to occurred_at >= start. The newest bucket is
    // open-ended, so events slightly in the future (allowed clock skew) still land in a bar.
    // `column` must be a column name written in our own SQL, never user input.
    bucketOf: (column: string) =>
      `LEAST(floor(extract(epoch FROM ${column} - ${start}) / ${size})::int, ${count} - 1)`,
  };
}

export interface Bucket {
  start: string;
  shadow: number;
  enforce: number;
}

export function toBucket(row: { start: Date; shadow: number; enforce: number }): Bucket {
  return { start: row.start.toISOString(), shadow: row.shadow, enforce: row.enforce };
}

// Per-bucket enforce/shadow counts for one player's or one remote's events in the window.
// The filter column is picked here from a fixed pair, never from input.
export async function bucketCounts(
  db: Querier,
  gameId: string,
  w: TimeWindow,
  filter: { playerId: number } | { remote: string },
): Promise<Bucket[]> {
  const [column, value] = "playerId" in filter ? ["player_id", filter.playerId] : ["remote", filter.remote];
  const b = bucketSql(1);
  const { rows } = await db.query(
    `SELECT s.start, coalesce(c.shadow, 0) AS shadow, coalesce(c.enforce, 0) AS enforce
     FROM (${b.series}) s
     LEFT JOIN (
       SELECT ${b.bucketOf("occurred_at")} AS i,
              count(*) FILTER (WHERE mode = 'shadow')  AS shadow,
              count(*) FILTER (WHERE mode = 'enforce') AS enforce
       FROM events
       WHERE game_id = $4 AND ${column} = $5 AND occurred_at >= $1
       GROUP BY 1
     ) c USING (i)
     ORDER BY s.i`,
    [...bucketParams(w), gameId, value],
  );
  return rows.map(toBucket);
}

// The same counts for several remotes at once (sparklines on the Remotes list). Every remote is
// crossed with every bucket before the counts are joined on, so quiet buckets come back as 0.
export async function bucketCountsByRemote(
  db: Querier,
  gameId: string,
  w: TimeWindow,
  remotes: string[],
): Promise<Map<string, Bucket[]>> {
  const b = bucketSql(1);
  const { rows } = await db.query(
    `SELECT r.remote, s.start, coalesce(c.shadow, 0) AS shadow, coalesce(c.enforce, 0) AS enforce
     FROM unnest($5::text[]) AS r(remote)
     CROSS JOIN (${b.series}) s
     LEFT JOIN (
       SELECT remote, ${b.bucketOf("occurred_at")} AS i,
              count(*) FILTER (WHERE mode = 'shadow')  AS shadow,
              count(*) FILTER (WHERE mode = 'enforce') AS enforce
       FROM events
       WHERE game_id = $4 AND occurred_at >= $1 AND remote = ANY($5)
       GROUP BY remote, i
     ) c ON c.remote = r.remote AND c.i = s.i
     ORDER BY r.remote, s.i`,
    [...bucketParams(w), gameId, remotes],
  );
  const byRemote = new Map<string, Bucket[]>(remotes.map((name) => [name, []]));
  for (const row of rows) byRemote.get(row.remote)!.push(toBucket(row));
  return byRemote;
}
