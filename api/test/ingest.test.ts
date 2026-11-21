import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_BATCH } from "../src/schemas/events.js";
import { bearer, createGame, makeEvent, rejections, resetDb, testApp, testDb } from "./helpers.js";

const db = testDb();
afterAll(() => db.end());

let keys: Awaited<ReturnType<typeof createGame>>;
beforeEach(async () => {
  await resetDb(db);
  keys = await createGame(db);
});

const post = (body: unknown, headers: Record<string, string> = bearer(keys.ingestKey), app = testApp(db)) =>
  app.inject({ method: "POST", url: "/v1/events", headers, payload: body as object });

describe("POST /v1/events: happy path", () => {
  it("stores a valid batch under the key's game", async () => {
    const res = await post({ events: [makeEvent(), makeEvent({ mode: "enforce", remote: "Trade" })] });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: 2 });

    const { rows } = await db.query("SELECT game_id, remote, mode FROM events ORDER BY id");
    expect(rows).toEqual([
      { game_id: keys.gameId, remote: "Attack", mode: "shadow" },
      { game_id: keys.gameId, remote: "Trade", mode: "enforce" },
    ]);
  });

  it("accepts exactly the max batch size", async () => {
    const res = await post({ events: Array.from({ length: MAX_BATCH }, () => makeEvent()) });
    expect(res.statusCode).toBe(202);
  });
});

describe("POST /v1/events: validation", () => {
  const cases: [string, unknown][] = [
    ["an empty batch", { events: [] }],
    ["more than 100 events", { events: Array.from({ length: MAX_BATCH + 1 }, () => makeEvent()) }],
    ["an unknown top-level field", { events: [makeEvent()], extra: 1 }],
    ["an unknown event field", { events: [{ ...makeEvent(), isAdmin: true }] }],
    ["a missing field", { events: [{ ...makeEvent(), rule: undefined }] }],
    ["a bad mode", { events: [makeEvent({ mode: "nuke" as "shadow" })] }],
    ["a string playerId", { events: [{ ...makeEvent(), playerId: "12345" }] }],
    ["a too-long detail", { events: [makeEvent({ detail: "x".repeat(257) })] }],
    ["a timestamp older than 24h", { events: [makeEvent({ timestamp: Date.now() - 25 * 3600_000 })] }],
    ["a timestamp in seconds, not ms", { events: [makeEvent({ timestamp: Math.floor(Date.now() / 1000) })] }],
    ["a bare array instead of { events }", [makeEvent()]],
  ];

  it.each(cases)("rejects %s with 400 and logs invalid_schema", async (_name, body) => {
    const res = await post(body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_schema");

    const logged = await rejections(db);
    expect(logged).toHaveLength(1);
    expect(logged[0]!.reason).toBe("invalid_schema");
    expect(logged[0]!.api_key_id).not.toBeNull();
  });

  it("reports which field failed", async () => {
    const res = await post({ events: [makeEvent(), { ...makeEvent(), playerId: -1 }] });
    expect(res.json().issues[0].path).toBe("events.1.playerId");
  });

  it("rejects malformed JSON as invalid_schema", async () => {
    const res = await testApp(db).inject({
      method: "POST",
      url: "/v1/events",
      headers: { ...bearer(keys.ingestKey), "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect((await rejections(db))[0]!.reason).toBe("invalid_schema");
  });

  it("rejects __proto__ keys (prototype pollution)", async () => {
    const res = await testApp(db).inject({
      method: "POST",
      url: "/v1/events",
      headers: { ...bearer(keys.ingestKey), "content-type": "application/json" },
      payload: `{"events":[${JSON.stringify(makeEvent())}],"__proto__":{"isAdmin":true}}`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_schema", code: "FST_ERR_CTP_INVALID_JSON_BODY" });
  });
});

describe("POST /v1/events: payload size", () => {
  it("rejects bodies over the limit with 413 and logs too_large", async () => {
    const app = testApp(db, { BODY_LIMIT_BYTES: 1024 });
    const res = await post({ events: [makeEvent({ detail: "x".repeat(200) })].concat(Array(10).fill(makeEvent())) }, undefined, app);
    expect(res.statusCode).toBe(413);
    const logged = await rejections(db);
    expect(logged.map((r) => r.reason)).toEqual(["too_large"]);
    expect(logged[0]!.api_key_id).not.toBeNull(); // auth ran first, so we know who sent it
  });
});

describe("POST /v1/events: auth", () => {
  it.each([
    ["no Authorization header", {}],
    ["a non-Bearer scheme", { authorization: "Basic abc" }],
    ["an unknown key", bearer("ocl_" + "A".repeat(43))],
  ])("rejects %s with 401 and logs bad_key", async (_name, headers) => {
    const res = await post({ events: [makeEvent()] }, headers as Record<string, string>);
    expect(res.statusCode).toBe(401);
    const logged = await rejections(db);
    expect(logged.map((r) => r.reason)).toEqual(["bad_key"]);
    expect(logged[0]!.api_key_id).toBeNull();
  });

  it("rejects a read key on the ingest endpoint with 403", async () => {
    const res = await post({ events: [makeEvent()] }, bearer(keys.readKey));
    expect(res.statusCode).toBe(403);
    expect((await rejections(db))[0]!.reason).toBe("bad_key");
  });

  it("rejects a revoked key", async () => {
    await db.query("UPDATE api_keys SET revoked_at = now()");
    const res = await post({ events: [makeEvent()] });
    expect(res.statusCode).toBe(401);
  });

  it("never stores the raw key", async () => {
    const { rows } = await db.query("SELECT key_hash, key_prefix FROM api_keys");
    for (const row of rows) {
      expect(row.key_hash.toString("utf8")).not.toContain(keys.ingestKey);
      expect(keys.ingestKey.startsWith(row.key_prefix) || keys.readKey.startsWith(row.key_prefix)).toBe(true);
      expect(row.key_prefix.length).toBeLessThan(12);
    }
  });

  it("checks auth before reading the body", async () => {
    const res = await post("{not json", {});
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/events: rate limiting", () => {
  it("returns 429 with Retry-After once the burst is spent, per key", async () => {
    const app = testApp(db, { INGEST_BURST: 3, INGEST_PER_MINUTE: 1 });
    const other = await createGame(db, "Other Game");
    const body = { events: [makeEvent()] };

    for (let i = 0; i < 3; i++) expect((await post(body, undefined, app)).statusCode).toBe(202);
    const limited = await post(body, undefined, app);
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);

    // A different game's key has its own bucket.
    expect((await post(body, bearer(other.ingestKey), app)).statusCode).toBe(202);
    expect((await rejections(db)).map((r) => r.reason)).toEqual(["rate_limited"]);
  });

  it("caps how many rejections get logged during a flood", async () => {
    const app = testApp(db);
    for (let i = 0; i < 40; i++) await post({ events: [makeEvent()] }, {}, app);
    expect((await rejections(db)).length).toBe(20);
  });
});
