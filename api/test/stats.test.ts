import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bearer, createGame, makeEvent, rejections, resetDb, testApp, testDb } from "./helpers.js";

const db = testDb();
afterAll(() => db.end());

const HOUR = 3600_000;
let keys: Awaited<ReturnType<typeof createGame>>;

const get = (url: string, key = keys.readKey) => testApp(db).inject({ method: "GET", url, headers: bearer(key) });

async function ingest(events: ReturnType<typeof makeEvent>[], key = keys.ingestKey) {
  const res = await testApp(db).inject({ method: "POST", url: "/v1/events", headers: bearer(key), payload: { events } });
  expect(res.statusCode).toBe(202);
}

// Older than the 24h window: inserted directly, since the API refuses such timestamps.
async function insertOld(gameId: string) {
  await db.query(
    `INSERT INTO events (game_id, api_key_id, occurred_at, server_id, player_id, player_name, remote, rule, detail, mode)
     SELECT $1, id, now() - interval '30 hours', 's', 1, 'Old', 'OldRemote', 'Schema', '', 'shadow'
     FROM api_keys WHERE game_id = $1 AND scope = 'ingest'`,
    [gameId],
  );
}

beforeEach(async () => {
  await resetDb(db);
  keys = await createGame(db);
  const now = Date.now();
  await ingest([
    makeEvent({ remote: "Attack", rule: "RateLimit", mode: "enforce", timestamp: now - 1000, playerId: 1, serverId: "a" }),
    makeEvent({ remote: "Attack", rule: "RateLimit", mode: "shadow", timestamp: now - 2000, playerId: 1, serverId: "a" }),
    makeEvent({ remote: "Attack", rule: "Schema", mode: "shadow", timestamp: now - 3 * HOUR, playerId: 2, serverId: "b" }),
    makeEvent({ remote: "Trade", rule: "Schema", mode: "enforce", timestamp: now - 5 * HOUR, playerId: 3, serverId: "b" }),
  ]);
  await insertOld(keys.gameId);
});

describe("GET /v1/stats/summary", () => {
  it("counts the last 24h only", async () => {
    const res = await get("/v1/stats/summary");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      total: 4,
      enforced: 2,
      shadowed: 2,
      uniquePlayers: 3,
      uniqueServers: 2,
      byRule: [
        { rule: "RateLimit", count: 2 },
        { rule: "Schema", count: 2 },
      ],
    });
  });

  it("is isolated per game", async () => {
    const other = await createGame(db, "Other");
    const res = await get("/v1/stats/summary", other.readKey);
    expect(res.json()).toMatchObject({ total: 0, lastEventAt: null, byRule: [] });
  });
});

describe("GET /v1/stats/hourly", () => {
  it("returns 24 ordered hourly buckets split by mode", async () => {
    const { hours } = (await get("/v1/stats/hourly")).json();
    expect(hours).toHaveLength(24);
    const times = hours.map((h: { hour: string }) => Date.parse(h.hour));
    expect(times).toEqual([...times].sort((a, b) => a - b));

    const sum = (mode: "shadow" | "enforce") => hours.reduce((n: number, h: Record<string, number>) => n + h[mode]!, 0);
    expect(sum("shadow")).toBe(2);
    expect(sum("enforce")).toBe(2);
  });
});

describe("GET /v1/stats/top-remotes", () => {
  it("ranks remotes by count and honours limit", async () => {
    expect((await get("/v1/stats/top-remotes")).json().remotes).toEqual([
      { remote: "Attack", count: 3 },
      { remote: "Trade", count: 1 },
    ]);
    expect((await get("/v1/stats/top-remotes?limit=1")).json().remotes).toHaveLength(1);
  });

  it("rejects an out-of-range limit", async () => {
    expect((await get("/v1/stats/top-remotes?limit=500")).statusCode).toBe(400);
  });
});

describe("GET /v1/violations", () => {
  it("lists newest first, including events older than 24h", async () => {
    const { items } = (await get("/v1/violations")).json();
    expect(items.map((v: { remote: string }) => v.remote)).toEqual(["Attack", "Attack", "Attack", "Trade", "OldRemote"]);
  });

  it("filters by rule", async () => {
    const { items } = (await get("/v1/violations?rule=RateLimit")).json();
    expect(items).toHaveLength(2);
    expect(items.every((v: { rule: string }) => v.rule === "RateLimit")).toBe(true);
  });

  it("pages with a cursor without skipping or repeating rows", async () => {
    const seen: number[] = [];
    let url = "/v1/violations?limit=2";
    for (let page = 0; page < 5; page++) {
      const body = (await get(url)).json();
      seen.push(...body.items.map((v: { id: number }) => v.id));
      if (!body.nextCursor) break;
      url = `/v1/violations?limit=2&cursor=${body.nextCursor}`;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it.each([
    ["an unknown query param", "/v1/violations?sort=asc"],
    ["a garbage cursor", "/v1/violations?cursor=bm9wZQ"],
    ["a non-numeric limit", "/v1/violations?limit=abc"],
  ])("rejects %s as invalid_schema", async (_name, url) => {
    const res = await get(url);
    expect(res.statusCode).toBe(400);
    expect((await rejections(db)).map((r) => r.reason)).toEqual(["invalid_schema"]);
  });
});

describe("dashboard auth", () => {
  it("refuses ingest keys on read endpoints", async () => {
    expect((await get("/v1/stats/summary", keys.ingestKey)).statusCode).toBe(403);
  });

  it("refuses requests with no key", async () => {
    const res = await testApp(db).inject({ method: "GET", url: "/v1/violations" });
    expect(res.statusCode).toBe(401);
  });

  it("rate limits read keys", async () => {
    const app = testApp(db, { READ_BURST: 2, READ_PER_MINUTE: 1 });
    const hit = () => app.inject({ method: "GET", url: "/v1/stats/summary", headers: bearer(keys.readKey) });
    expect([(await hit()).statusCode, (await hit()).statusCode, (await hit()).statusCode]).toEqual([200, 200, 429]);
  });
});
