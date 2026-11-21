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
const names = (body: { items: { remote: string }[] }) => body.items.map((r) => r.remote);
const detailUrl = (remote: string, query = "") => `/v1/remotes/${encodeURIComponent(remote)}${query}`;
const sum = (buckets: { shadow: number; enforce: number }[], mode: "shadow" | "enforce") =>
  buckets.reduce((n, b) => n + b[mode], 0);

/*
  Three remotes inside 24h and one only 30h ago:
    Attack  4 events, all enforce, 2 players (1 ×3, 2 ×1)
    Trade   3 events, all shadow, 3 players
    Emote   5 events by one player: 4 shadow, then 1 enforce (newest) → current mode "enforce"
    Legacy  1 event 30h ago: only in the 7d window
  So by total: Emote, Attack, Trade · by enforced: Attack, Emote, Trade · by uniquePlayers: Trade, Attack, Emote
*/
async function seedRemotes() {
  await add(
    { remote: "Attack", playerId: 1, playerName: "Exploiter", rule: "RateLimit", mode: "enforce", timestamp: ago(5 * MINUTE) },
    { remote: "Attack", playerId: 1, playerName: "Exploiter", rule: "RateLimit", mode: "enforce", timestamp: ago(10 * MINUTE) },
    { remote: "Attack", playerId: 1, playerName: "Exploiter", rule: "RateLimit", mode: "enforce", timestamp: ago(3 * HOUR) },
    { remote: "Attack", playerId: 2, playerName: "Pixel", rule: "Schema", mode: "enforce", timestamp: ago(20 * MINUTE) },
    { remote: "Trade", playerId: 1, rule: "Schema", mode: "shadow", timestamp: ago(HOUR) },
    { remote: "Trade", playerId: 2, rule: "Schema", mode: "shadow", timestamp: ago(2 * HOUR) },
    { remote: "Trade", playerId: 3, rule: "Schema", mode: "shadow", timestamp: ago(3 * HOUR) },
    ...Array.from({ length: 4 }, (_, i) => ({
      remote: "Emote",
      playerId: 5,
      rule: "RateLimit",
      mode: "shadow" as const,
      timestamp: ago(5 * HOUR + i * MINUTE),
    })),
    { remote: "Emote", playerId: 5, rule: "RateLimit", mode: "enforce", timestamp: ago(2 * MINUTE) },
    { remote: "Legacy", playerId: 9, mode: "shadow", timestamp: ago(30 * HOUR) },
  );
}

beforeEach(async () => {
  await resetDb(db);
  keys = await createGame(db);
  now = Date.now();
});

describe("GET /v1/remotes", () => {
  beforeEach(seedRemotes);

  it("returns one row per remote with breakdown, mode and sparkline buckets", async () => {
    const res = await get("/v1/remotes");
    expect(res.statusCode).toBe(200);
    const { items } = res.json();
    expect(names({ items })).toEqual(["Emote", "Attack", "Trade"]);

    const attack = items[1];
    expect(attack).toMatchObject({
      remote: "Attack",
      total: 4,
      enforced: 4,
      shadowed: 0,
      uniquePlayers: 2,
      byRule: [
        { rule: "RateLimit", count: 3 },
        { rule: "Schema", count: 1 },
      ],
      lastSeen: iso(ago(5 * MINUTE)),
      mode: "enforce",
    });
    expect(attack.buckets).toHaveLength(24);
    expect([sum(attack.buckets, "enforce"), sum(attack.buckets, "shadow")]).toEqual([4, 0]);
  });

  it("reports the mode of each remote's newest event", async () => {
    const { items } = (await get("/v1/remotes")).json();
    expect(items.map((r: { remote: string; mode: string }) => [r.remote, r.mode])).toEqual([
      ["Emote", "enforce"], // 4 shadow events, but the newest one is enforce
      ["Attack", "enforce"],
      ["Trade", "shadow"],
    ]);
  });

  it("gives every remote a full set of buckets, zeros included", async () => {
    const { items } = (await get("/v1/remotes?window=1h")).json();
    expect(names({ items })).toEqual(["Attack", "Emote"]);
    for (const r of items) expect(r.buckets).toHaveLength(12);
    expect(sum(items[0].buckets, "enforce")).toBe(3); // the 3 Attack events in the last hour
  });

  it("reaches older remotes in the 7d window", async () => {
    expect(names((await get("/v1/remotes?window=7d")).json())).toEqual(["Emote", "Attack", "Trade", "Legacy"]);
  });

  it.each([
    ["total", ["Emote", "Attack", "Trade"]],
    ["enforced", ["Attack", "Emote", "Trade"]],
    ["uniquePlayers", ["Trade", "Attack", "Emote"]],
  ])("sorts by %s", async (sort, expected) => {
    expect(names((await get(`/v1/remotes?sort=${sort}`)).json())).toEqual(expected);
  });

  it("is isolated per game", async () => {
    const other = await createGame(db, "Other");
    expect((await get("/v1/remotes", other.readKey)).json()).toEqual({ items: [] });
  });
});

describe("GET /v1/remotes size cap", () => {
  it("returns at most 200 remotes", async () => {
    await add(...Array.from({ length: 201 }, (_, i) => ({ remote: `R${i}`, timestamp: ago(MINUTE) })));
    expect((await get("/v1/remotes")).json().items).toHaveLength(200);
  });
});

describe("GET /v1/remotes/:remote", () => {
  beforeEach(seedRemotes);

  it("returns the remote's summary, rule breakdown, top players and buckets", async () => {
    const res = await get(detailUrl("Attack"));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.remote).toEqual({
      remote: "Attack",
      total: 4,
      enforced: 4,
      shadowed: 0,
      uniquePlayers: 2,
      lastSeen: iso(ago(5 * MINUTE)),
      mode: "enforce",
    });
    expect(body.byRule).toEqual([
      { rule: "RateLimit", count: 3 },
      { rule: "Schema", count: 1 },
    ]);
    expect(body.topPlayers).toEqual([
      { playerId: 1, playerName: "Exploiter", total: 3, enforced: 3 },
      { playerId: 2, playerName: "Pixel", total: 1, enforced: 1 },
    ]);
    expect(body.buckets).toHaveLength(24);
    expect(sum(body.buckets, "enforce")).toBe(4);
  });

  it("caps top players at 10, most violations first", async () => {
    await add(
      ...Array.from({ length: 12 }, (_, i) =>
        Array.from({ length: i + 1 }, () => ({ remote: "Crowded", playerId: 100 + i, timestamp: ago(MINUTE) })),
      ).flat(),
    );
    const { topPlayers } = (await get(detailUrl("Crowded"))).json();
    expect(topPlayers.map((p: { playerId: number }) => p.playerId)).toEqual([111, 110, 109, 108, 107, 106, 105, 104, 103, 102]);
  });

  it("decodes URL-encoded names", async () => {
    const name = "Shop/Buy Item ✓";
    await add({ remote: name, timestamp: ago(MINUTE) });
    const res = await get(detailUrl(name));
    expect(res.statusCode).toBe(200);
    expect(res.json().remote).toMatchObject({ remote: name, total: 1 });
  });

  it("accepts a 100-character name, even when it encodes to far more", async () => {
    const name = "é".repeat(100); // 600 characters once URL-encoded
    await add({ remote: name, timestamp: ago(MINUTE) });
    expect((await get(detailUrl(name))).statusCode).toBe(200);
  });

  it("returns zeros and the current mode for a known remote with nothing in the window", async () => {
    const body = (await get(detailUrl("Legacy"))).json();
    expect(body.remote).toEqual({
      remote: "Legacy",
      total: 0,
      enforced: 0,
      shadowed: 0,
      uniquePlayers: 0,
      lastSeen: null,
      mode: "shadow",
    });
    expect(body.topPlayers).toEqual([]);
  });

  it("answers 404 for a remote never seen in this game, without logging a rejection", async () => {
    const res = await get(detailUrl("Nope"));
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "not_found" });
    expect(await rejections(db)).toEqual([]);
  });

  it("is isolated per game", async () => {
    const other = await createGame(db, "Other");
    expect((await get(detailUrl("Attack"), other.readKey)).statusCode).toBe(404);
  });
});

describe("remotes window boundaries", () => {
  it.each(["1h", "24h", "7d"] as const)("%s: an event just inside counts, one just outside doesn't", async (window) => {
    await add({ remote: "Inside", timestamp: ago(SPAN[window] - 5000) }, { remote: "Outside", timestamp: ago(SPAN[window] + 5000) });

    const { items } = (await get(`/v1/remotes?window=${window}`)).json();
    expect(names({ items })).toEqual(["Inside"]);
    expect(items[0].buckets).toHaveLength(BUCKETS[window]);
    expect(items[0].buckets[0].shadow).toBe(1); // lands in the oldest bucket

    expect((await get(detailUrl("Inside", `?window=${window}`))).json().remote.total).toBe(1);
    expect((await get(detailUrl("Outside", `?window=${window}`))).json().remote.total).toBe(0);
  });
});

describe("remotes validation", () => {
  it.each([
    ["an unknown param", "/v1/remotes?limit=5"],
    ["a bad window", "/v1/remotes?window=1d"],
    ["a bad sort", "/v1/remotes?sort=name"],
    ["a remote name over 100 chars", detailUrl("a".repeat(101))],
    ["a bad window on detail", detailUrl("Attack", "?window=week")],
    ["an unknown param on detail", detailUrl("Attack", "?sort=total")],
  ])("rejects %s as invalid_schema", async (_name, url) => {
    const res = await get(url);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_schema" });
    expect((await rejections(db)).map((r) => r.reason)).toEqual(["invalid_schema"]);
  });
});

describe("remotes auth", () => {
  it.each(["/v1/remotes", "/v1/remotes/Attack"])("%s refuses an ingest key (403) and no key (401)", async (url) => {
    expect((await get(url, keys.ingestKey)).statusCode).toBe(403);
    expect((await testApp(db).inject({ method: "GET", url })).statusCode).toBe(401);
  });
});
