import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ViolationEvent } from "../src/schemas/events.js";
import { bearer, createGame, insertDirect, makeEvent, rejections, resetDb, testApp, testDb } from "./helpers.js";

// The playerId and remote filters on GET /v1/violations (used by the drawer timelines).
const db = testDb();
afterAll(() => db.end());

type Item = { id: number; playerId: number; remote: string; rule: string; occurredAt: string };

let keys: Awaited<ReturnType<typeof createGame>>;

const get = (url: string, key = keys.readKey) => testApp(db).inject({ method: "GET", url, headers: bearer(key) });
const items = async (url: string): Promise<Item[]> => (await get(url)).json().items;

/*
  12 events, one per minute (newest first by index), cycling through:
    players 1, 2, 3 · remotes Attack, Trade · rules RateLimit, Schema
*/
beforeEach(async () => {
  await resetDb(db);
  keys = await createGame(db);
  const now = Date.now();
  const events: Partial<ViolationEvent>[] = Array.from({ length: 12 }, (_, i) => ({
    playerId: (i % 3) + 1,
    remote: i % 2 === 0 ? "Attack" : "Trade",
    rule: i % 4 < 2 ? "RateLimit" : "Schema",
    timestamp: now - (i + 1) * 60_000,
  }));
  await insertDirect(db, keys.gameId, events.map((e) => makeEvent(e)));
});

const newestFirst = (list: Item[]) =>
  list.every((v, i) => i === 0 || Date.parse(list[i - 1]!.occurredAt) >= Date.parse(v.occurredAt));

describe("GET /v1/violations filters", () => {
  it("filters by playerId, newest first", async () => {
    const list = await items("/v1/violations?playerId=2");
    expect(list).toHaveLength(4);
    expect(list.every((v) => v.playerId === 2)).toBe(true);
    expect(newestFirst(list)).toBe(true);
  });

  it("filters by remote", async () => {
    const list = await items("/v1/violations?remote=Trade");
    expect(list).toHaveLength(6);
    expect(list.every((v) => v.remote === "Trade")).toBe(true);
  });

  it("combines playerId with rule", async () => {
    const list = await items("/v1/violations?playerId=1&rule=Schema");
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((v) => v.playerId === 1 && v.rule === "Schema")).toBe(true);
    // Check the count against the fixture directly: i ≡ 0 (mod 3) and i mod 4 ∈ {2, 3}.
    expect(list).toHaveLength([...Array(12).keys()].filter((i) => i % 3 === 0 && i % 4 >= 2).length);
  });

  it("combines remote with rule", async () => {
    const list = await items("/v1/violations?remote=Attack&rule=RateLimit");
    expect(list).toHaveLength([...Array(12).keys()].filter((i) => i % 2 === 0 && i % 4 < 2).length);
    expect(list.every((v) => v.remote === "Attack" && v.rule === "RateLimit")).toBe(true);
  });

  it.each([
    ["playerId", "playerId=3", 4],
    ["remote", "remote=Attack", 6],
    ["playerId + rule", "playerId=1&rule=RateLimit", 2],
  ])("pages a %s filter with the cursor, without gaps or repeats", async (_name, filter, expected) => {
    const seen: Item[] = [];
    let url = `/v1/violations?${filter}&limit=1`;
    for (let page = 0; page < 20; page++) {
      const body = (await get(url)).json();
      seen.push(...body.items);
      if (!body.nextCursor) break;
      url = `/v1/violations?${filter}&limit=1&cursor=${body.nextCursor}`;
    }
    const all = await items(`/v1/violations?${filter}`);
    expect(seen.map((v) => v.id)).toEqual(all.map((v) => v.id));
    expect(new Set(seen.map((v) => v.id)).size).toBe(expected);
  });

  it("returns nothing for an unknown player or remote", async () => {
    expect(await items("/v1/violations?playerId=999")).toEqual([]);
    expect(await items("/v1/violations?remote=Nope")).toEqual([]);
  });

  it("is isolated per game, even for the same player id", async () => {
    const other = await createGame(db, "Other");
    expect((await get("/v1/violations?playerId=1", other.readKey)).json().items).toEqual([]);
  });

  it.each([
    ["a non-numeric playerId", "/v1/violations?playerId=abc"],
    ["playerId 0", "/v1/violations?playerId=0"],
    ["an empty remote", "/v1/violations?remote="],
    ["a remote over 100 chars", `/v1/violations?remote=${"a".repeat(101)}`],
  ])("rejects %s as invalid_schema", async (_name, url) => {
    const res = await get(url);
    expect(res.statusCode).toBe(400);
    expect((await rejections(db)).map((r) => r.reason)).toEqual(["invalid_schema"]);
  });
});
