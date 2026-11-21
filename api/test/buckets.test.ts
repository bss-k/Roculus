import { afterAll, describe, expect, it } from "vitest";
import { timeWindow, WINDOWS } from "../src/lib/windows.js";
import { bucketParams, bucketSql } from "../src/repo/buckets.js";
import { windowParam } from "../src/schemas/queries.js";
import { testDb } from "./helpers.js";

const db = testDb();
afterAll(() => db.end());

const MINUTE = 60_000;
const asOf = new Date("2026-01-01T12:00:00.000Z");

describe("timeWindow", () => {
  it.each([
    ["1h", 12, 5 * MINUTE],
    ["24h", 24, 60 * MINUTE],
    ["7d", 28, 6 * 60 * MINUTE],
  ] as const)("%s → %i buckets of %i ms that tile the window exactly", (id, buckets, bucketMs) => {
    const w = timeWindow(id, asOf);
    expect(w.buckets).toBe(buckets);
    expect(w.bucketSeconds * 1000).toBe(bucketMs);
    expect(asOf.getTime() - w.start.getTime()).toBe(buckets * bucketMs);
  });
});

describe("windowParam", () => {
  it("defaults to 24h and accepts only the three windows", () => {
    expect(windowParam.parse(undefined)).toBe("24h");
    expect(Object.keys(WINDOWS).map((id) => windowParam.parse(id))).toEqual(["1h", "24h", "7d"]);
    expect(windowParam.safeParse("2h").success).toBe(false);
  });
});

describe("bucketSql", () => {
  const w = timeWindow("1h", asOf);
  const b = bucketSql(1);

  it("lists the buckets oldest first, ending one bucket before asOf", async () => {
    const { rows } = await db.query<{ i: number; start: Date }>(`${b.series} ORDER BY i`, bucketParams(w));
    expect(rows).toHaveLength(12);
    expect(rows[0]!.start.toISOString()).toBe(w.start.toISOString());
    expect(rows[11]!.start.getTime()).toBe(asOf.getTime() - 5 * MINUTE);
  });

  it("puts each timestamp in the right bucket, including the edges", async () => {
    const at = (offsetMs: number) => new Date(w.start.getTime() + offsetMs).toISOString();
    const cases: [string, number][] = [
      [at(0), 0], // exactly the window start
      [at(5 * MINUTE - 1), 0], // last millisecond of bucket 0
      [at(5 * MINUTE), 1], // first millisecond of bucket 1
      [new Date(asOf.getTime() - 1).toISOString(), 11], // just before asOf
      [new Date(asOf.getTime() + 2 * MINUTE).toISOString(), 11], // future (clock skew) → newest bucket
    ];
    const { rows } = await db.query<{ i: number }>(
      `SELECT ${b.bucketOf("t")} AS i FROM unnest($4::timestamptz[]) WITH ORDINALITY AS u(t, n) ORDER BY n`,
      [...bucketParams(w), cases.map(([t]) => t)],
    );
    expect(rows.map((r) => r.i)).toEqual(cases.map(([, i]) => i));
  });
});

describe("migration 002", () => {
  it("indexes events by player and by remote in time order", async () => {
    const { rows } = await db.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'events' AND indexname IN ('events_game_player', 'events_game_remote') ORDER BY indexname",
    );
    expect(rows.map((r) => [r.indexname, r.indexdef.replace(/.*USING btree /, "")])).toEqual([
      ["events_game_player", "(game_id, player_id, occurred_at DESC, id DESC)"],
      ["events_game_remote", "(game_id, remote, occurred_at DESC, id DESC)"],
    ]);
  });
});
