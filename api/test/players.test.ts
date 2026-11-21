import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ViolationEvent } from "../src/schemas/events.js";
import { bearer, createGame, insertDirect, makeEvent, rejections, resetDb, testApp, testDb } from "./helpers.js";

const db = testDb();
afterAll(() => db.end());

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SPAN = { "1h": HOUR, "24h": DAY, "7d": 7 * DAY } as const;
const BUCKETS = { "1h": 12, "24h": 24, "7d": 28 } as const;

let keys: Awaited<ReturnType<typeof createGame>>;
let now: number;

const get = (url: string, key = keys.readKey) => testApp(db).inject({ method: "GET", url, headers: bearer(key) });
const ago = (ms: number) => now - ms;
const iso = (ms: number) => new Date(ms).toISOString();
const add = (...events: Partial<ViolationEvent>[]) => insertDirect(db, keys.gameId, events.map((e) => makeEvent(e)));
const ids = (body: { items: { playerId: number }[] }) => body.items.map((p) => p.playerId);

/*
  Three players inside 24h and one only 30h ago:
    1  5 events, 4 enforced, renamed Shadowfax → Builderman, last seen 10 min ago
    2  6 events, 0 enforced ("ShadowNinja"), last seen 2h ago
    3  1 event,  1 enforced ("Pixel"), last seen 1 min ago
    4  1 event 30h ago ("Ghost"): only in the 7d window
  So by total: 2, 1, 3 · by enforced: 1, 3, 2 · by lastSeen: 3, 1, 2
*/
async function seedPlayers() {
  await add(
    { playerId: 1, playerName: "Shadowfax", rule: "Schema", remote: "Trade", mode: "shadow", serverId: "a", timestamp: ago(4 * HOUR) },
    { playerId: 1, playerName: "Shadowfax", rule: "RateLimit", remote: "Attack", mode: "enforce", serverId: "a", timestamp: ago(3 * HOUR) },
    { playerId: 1, playerName: "Builderman", rule: "RateLimit", remote: "Attack", mode: "enforce", serverId: "b", timestamp: ago(150 * MINUTE) },
    { playerId: 1, playerName: "Builderman", rule: "RateLimit", remote: "Attack", mode: "enforce", serverId: "b", timestamp: ago(HOUR) },
    { playerId: 1, playerName: "Builderman", rule: "RateLimit", remote: "Attack", mode: "enforce", serverId: "b", timestamp: ago(10 * MINUTE) },
    ...Array.from({ length: 6 }, (_, i) => ({
      playerId: 2,
      playerName: "ShadowNinja",
      rule: "Schema",
      remote: "Emote",
      mode: "shadow" as const,
      timestamp: ago(2 * HOUR + i * MINUTE),
    })),
    { playerId: 3, playerName: "Pixel", rule: "Check", remote: "Interact", mode: "enforce", timestamp: ago(MINUTE) },
    { playerId: 4, playerName: "Ghost", timestamp: ago(30 * HOUR) },
  );
}

beforeEach(async () => {
  await resetDb(db);
  keys = await createGame(db);
  now = Date.now();
});

describe("GET /v1/players", () => {
  beforeEach(seedPlayers);

  it("returns one aggregated row per player in the last 24h by default", async () => {
    const res = await get("/v1/players");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(ids(body)).toEqual([2, 1, 3]);
    expect(body.items[1]).toEqual({
      playerId: 1,
      playerName: "Builderman", // the newest name, not the first one
      total: 5,
      enforced: 4,
      shadowed: 1,
      rules: ["RateLimit", "Schema"],
      remotes: 2,
      firstSeen: iso(ago(4 * HOUR)),
      lastSeen: iso(ago(10 * MINUTE)),
    });
    expect(body.nextOffset).toBeNull();
  });

  it("follows the window: 1h is narrower, 7d reaches older players", async () => {
    const short = (await get("/v1/players?window=1h")).json();
    expect(ids(short)).toEqual([1, 3]);
    expect(short.items[0]).toMatchObject({ playerId: 1, total: 1 }); // only the event 10 min ago
    expect(ids((await get("/v1/players?window=7d")).json())).toEqual([2, 1, 3, 4]);
  });

  it.each([
    ["total", [2, 1, 3]],
    ["enforced", [1, 3, 2]],
    ["lastSeen", [3, 1, 2]],
  ])("sorts by %s", async (sort, expected) => {
    expect(ids((await get(`/v1/players?sort=${sort}`)).json())).toEqual(expected);
  });

  describe("search (q)", () => {
    it("matches a name prefix case-insensitively", async () => {
      expect(ids((await get("/v1/players?q=build")).json())).toEqual([1]);
    });

    it("matches any name the player used in the window, and still counts all their events", async () => {
      const body = (await get("/v1/players?q=shadow")).json();
      expect(ids(body)).toEqual([2, 1]);
      expect(body.items[1]).toMatchObject({ playerName: "Builderman", total: 5 });
    });

    it("treats an all-digit q as an exact player id", async () => {
      expect(ids((await get("/v1/players?q=3")).json())).toEqual([3]);
    });

    it("treats LIKE wildcards literally", async () => {
      expect(ids((await get("/v1/players?q=B%25")).json())).toEqual([]); // q = "B%"
      expect(ids((await get("/v1/players?q=_")).json())).toEqual([]);
    });
  });

  it("pages with limit and offset without repeating or skipping players", async () => {
    const first = (await get("/v1/players?limit=2")).json();
    expect(ids(first)).toEqual([2, 1]);
    expect(first.nextOffset).toBe(2);

    const second = (await get(`/v1/players?limit=2&offset=${first.nextOffset}`)).json();
    expect(ids(second)).toEqual([3]);
    expect(second.nextOffset).toBeNull();
  });

  it("is isolated per game", async () => {
    const other = await createGame(db, "Other");
    expect((await get("/v1/players", other.readKey)).json()).toEqual({ items: [], nextOffset: null });
  });
});

describe("GET /v1/players paging cap", () => {
  it("stops offering pages past the maximum offset", async () => {
    await add(...Array.from({ length: 1002 }, (_, i) => ({ playerId: 1000 + i, timestamp: ago(MINUTE) })));
    const body = (await get("/v1/players?offset=1000&limit=1")).json();
    expect(body.items).toHaveLength(1);
    expect(body.nextOffset).toBeNull(); // a 1001st offset would be refused, so none is offered
  });
});

describe("GET /v1/players/:playerId", () => {
  beforeEach(seedPlayers);

  it("returns the player's summary, breakdowns and buckets", async () => {
    const res = await get("/v1/players/1");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.player).toEqual({
      playerId: 1,
      playerName: "Builderman",
      total: 5,
      enforced: 4,
      shadowed: 1,
      servers: 2,
      firstSeen: iso(ago(4 * HOUR)),
      lastSeen: iso(ago(10 * MINUTE)),
    });
    expect(body.byRule).toEqual([
      { rule: "RateLimit", count: 4 },
      { rule: "Schema", count: 1 },
    ]);
    expect(body.byRemote).toEqual([
      { remote: "Attack", count: 4 },
      { remote: "Trade", count: 1 },
    ]);

    // 24 hourly buckets, oldest first, that add up to the totals.
    const starts = body.buckets.map((b: { start: string }) => Date.parse(b.start));
    expect(starts).toHaveLength(24);
    expect(starts.slice(1).map((t: number, i: number) => t - starts[i])).toEqual(Array(23).fill(HOUR));
    const sum = (mode: "shadow" | "enforce") => body.buckets.reduce((n: number, b: Record<string, number>) => n + b[mode]!, 0);
    expect([sum("enforce"), sum("shadow")]).toEqual([4, 1]);
  });

  it("returns zeros (not 404) for a known player with nothing in the window", async () => {
    const body = (await get("/v1/players/4")).json();
    expect(body.player).toEqual({
      playerId: 4,
      playerName: "Ghost",
      total: 0,
      enforced: 0,
      shadowed: 0,
      servers: 0,
      firstSeen: null,
      lastSeen: null,
    });
    expect(body.byRule).toEqual([]);
    expect(body.buckets.every((b: { shadow: number; enforce: number }) => b.shadow + b.enforce === 0)).toBe(true);
  });

  it("answers 404 for a player never seen in this game, without logging a rejection", async () => {
    const res = await get("/v1/players/999");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "not_found" });
    expect(await rejections(db)).toEqual([]);
  });

  it("is isolated per game", async () => {
    const other = await createGame(db, "Other");
    expect((await get("/v1/players/1", other.readKey)).statusCode).toBe(404);
  });
});

describe("window boundaries", () => {
  it.each(["1h", "24h", "7d"] as const)("%s: an event just inside counts, one just outside doesn't", async (window) => {
    // asOf is taken after `now`, so "5s inside" stays inside as long as the request takes under 5s.
    await add({ playerId: 10, timestamp: ago(SPAN[window] - 5000) }, { playerId: 11, timestamp: ago(SPAN[window] + 5000) });

    expect(ids((await get(`/v1/players?window=${window}`)).json())).toEqual([10]);

    const inside = (await get(`/v1/players/10?window=${window}`)).json();
    expect(inside.player.total).toBe(1);
    expect(inside.buckets).toHaveLength(BUCKETS[window]);
    expect(inside.buckets[0].shadow).toBe(1); // lands in the oldest bucket

    expect((await get(`/v1/players/11?window=${window}`)).json().player.total).toBe(0);
  });
});

describe("players validation", () => {
  it.each([
    ["an unknown param", "/v1/players?foo=1"],
    ["a bad window", "/v1/players?window=30d"],
    ["a bad sort", "/v1/players?sort=name"],
    ["limit over 50", "/v1/players?limit=51"],
    ["limit 0", "/v1/players?limit=0"],
    ["offset over 1000", "/v1/players?offset=1001"],
    ["a negative offset", "/v1/players?offset=-1"],
    ["an empty q", "/v1/players?q="],
    ["q over 32 chars", `/v1/players?q=${"a".repeat(33)}`],
    ["a non-numeric player id", "/v1/players/abc"],
    ["player id 0", "/v1/players/0"],
    ["a player id in exponent form", "/v1/players/1e3"],
    ["a player id over 2^53", "/v1/players/9999999999999999"],
    ["a bad window on detail", "/v1/players/1?window=2h"],
    ["an unknown param on detail", "/v1/players/1?sort=total"],
  ])("rejects %s as invalid_schema", async (_name, url) => {
    const res = await get(url);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_schema" });
    expect((await rejections(db)).map((r) => r.reason)).toEqual(["invalid_schema"]);
  });
});

describe("players auth", () => {
  it.each(["/v1/players", "/v1/players/1"])("%s refuses an ingest key (403) and no key (401)", async (url) => {
    expect((await get(url, keys.ingestKey)).statusCode).toBe(403);
    expect((await testApp(db).inject({ method: "GET", url })).statusCode).toBe(401);
  });
});
