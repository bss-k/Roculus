import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bearer, createGame, makeEvent, resetDb, testApp, testDb } from "./helpers.js";

const db = testDb();
afterAll(() => db.end());

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let a: Awaited<ReturnType<typeof createGame>>;
let b: Awaited<ReturnType<typeof createGame>>;
beforeEach(async () => {
  await resetDb(db);
  a = await createGame(db, "Game A");
  b = await createGame(db, "Game B");
});

const get = (url: string, key = a.readKey) => testApp(db).inject({ method: "GET", url, headers: bearer(key) });

async function post(events: ReturnType<typeof makeEvent>[], key = a.ingestKey) {
  return testApp(db).inject({ method: "POST", url: "/v1/events", headers: bearer(key), payload: { events } });
}

// Ingest through the API, then move the batch's arrival time (the API always stamps now()).
async function ingestAt(msAgo: number, serverId: string, n = 1, key = a.ingestKey) {
  const res = await post(Array.from({ length: n }, () => makeEvent({ serverId })), key);
  expect(res.statusCode).toBe(202);
  await db.query("UPDATE events SET received_at = now() - $2 * interval '1 millisecond' WHERE server_id = $1", [
    serverId,
    msAgo,
  ]);
}

async function rejectionAt(msAgo: number, reason: string, apiKeyId: string | null) {
  await db.query(
    `INSERT INTO rejected_requests (received_at, reason, api_key_id, ip, route)
     VALUES (now() - $1 * interval '1 millisecond', $2, $3, '127.0.0.1', '/v1/events')`,
    [msAgo, reason, apiKeyId],
  );
}

async function keyId(gameId: string, scope: string) {
  const { rows } = await db.query<{ id: string }>("SELECT id FROM api_keys WHERE game_id = $1 AND scope = $2", [gameId, scope]);
  return rows[0]!.id;
}

describe("GET /v1/ingestion", () => {
  it("counts accepted events per bucket by arrival time, inside the window only", async () => {
    await ingestAt(2 * MINUTE, "recent", 3);
    await ingestAt(HOUR - MINUTE, "edge-in", 2);
    await ingestAt(HOUR + MINUTE, "edge-out", 5);
    const res = await get("/v1/ingestion?window=1h");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.buckets).toHaveLength(12);
    expect(body.totals.accepted).toBe(5);
    expect(body.buckets[0].accepted).toBe(2); // the oldest 5-minute bucket
    expect(body.buckets[11].accepted).toBe(3); // the newest
    expect(body.buckets.reduce((sum: number, x: { accepted: number }) => sum + x.accepted, 0)).toBe(5);
  });

  it("uses the 24h and 7d windows", async () => {
    await ingestAt(23 * HOUR, "day", 1);
    await ingestAt(25 * HOUR, "two-days", 1);
    await ingestAt(8 * 24 * HOUR, "too-old", 1);
    expect((await get("/v1/ingestion")).json().totals.accepted).toBe(1); // default 24h
    const week = (await get("/v1/ingestion?window=7d")).json();
    expect(week.totals.accepted).toBe(2);
    expect(week.buckets).toHaveLength(28);
  });

  it("splits refused requests by reason, for this game's keys only", async () => {
    const aIngest = await keyId(a.gameId, "ingest");
    const aRead = await keyId(a.gameId, "read");
    await rejectionAt(MINUTE, "invalid_schema", aIngest);
    await rejectionAt(MINUTE, "invalid_schema", aIngest);
    await rejectionAt(MINUTE, "rate_limited", aIngest);
    await rejectionAt(MINUTE, "bad_key", aRead); // e.g. wrong scope
    await rejectionAt(2 * HOUR, "too_large", aIngest); // outside 1h
    await rejectionAt(MINUTE, "rate_limited", await keyId(b.gameId, "ingest")); // game B's

    const body = (await get("/v1/ingestion?window=1h")).json();
    expect(body.totals.rejected).toBe(4);
    expect(body.totals.byReason).toEqual({ bad_key: 1, invalid_schema: 2, rate_limited: 1, too_large: 0 });
    expect(body.buckets[11].byReason).toEqual(body.totals.byReason);
    expect(body.buckets[11].rejected).toBe(4);
  });

  it("records real refusals end to end: bad payload, wrong scope, expired key", async () => {
    expect((await post([{ ...makeEvent(), extra: 1 } as never])).statusCode).toBe(400);
    expect((await post([makeEvent()], a.readKey)).statusCode).toBe(403);
    await db.query("UPDATE api_keys SET expires_at = now() WHERE id = $1", [await keyId(a.gameId, "ingest")]);
    expect((await post([makeEvent()])).statusCode).toBe(401);

    const body = (await get("/v1/ingestion?window=1h")).json();
    expect(body.totals.byReason).toEqual({ bad_key: 2, invalid_schema: 1, rate_limited: 0, too_large: 0 });
    expect(body.unattributedBadKey.count).toBe(0);
  });

  it("counts unattributed bad_key refusals separately, labeled as all games", async () => {
    await testApp(db).inject({ method: "POST", url: "/v1/events", headers: bearer("ocl_" + "Z".repeat(43)), payload: {} });
    await testApp(db).inject({ method: "GET", url: "/v1/stats/summary" }); // no key at all
    await rejectionAt(2 * HOUR, "bad_key", null); // outside 1h

    const body = (await get("/v1/ingestion?window=1h")).json();
    expect(body.unattributedBadKey).toEqual({ count: 2, scope: "all_games" });
    expect(body.totals.rejected).toBe(0); // not counted as this game's
    // Game B sees the same server-wide count (it's not anyone's), but none of A's numbers.
    expect((await get("/v1/ingestion?window=1h", b.readKey)).json().unattributedBadKey.count).toBe(2);
  });

  it("isolates games: B's events never show up for A", async () => {
    await ingestAt(MINUTE, "b-server", 4, b.ingestKey);
    expect((await get("/v1/ingestion?window=1h")).json().totals.accepted).toBe(0);
    expect((await get("/v1/ingestion?window=1h", b.readKey)).json().totals.accepted).toBe(4);
  });
});

describe("GET /v1/ingestion/servers", () => {
  it("lists each server's events and first/last arrival, most recent first", async () => {
    await ingestAt(30 * MINUTE, "s1", 2);
    await db.query("UPDATE events SET received_at = now() - interval '50 minutes' WHERE id = (SELECT min(id) FROM events)");
    await ingestAt(MINUTE, "s2", 1);
    const body = (await get("/v1/ingestion/servers?window=1h")).json();
    expect(body.silentAfterMinutes).toBe(10);
    expect(body.truncated).toBe(false);
    expect(body.items.map((s: { serverId: string }) => s.serverId)).toEqual(["s2", "s1"]);
    const s1 = body.items[1];
    expect(s1.events).toBe(2);
    expect(Date.parse(s1.lastReceived) - Date.parse(s1.firstReceived)).toBeGreaterThan(19 * MINUTE);
  });

  it("flags servers silent for more than 10 minutes", async () => {
    await ingestAt(9 * MINUTE, "fresh");
    await ingestAt(11 * MINUTE, "quiet");
    const items = (await get("/v1/ingestion/servers?window=1h")).json().items;
    expect(Object.fromEntries(items.map((s: { serverId: string; silent: boolean }) => [s.serverId, s.silent]))).toEqual({
      fresh: false,
      quiet: true,
    });
  });

  it("stays inside the window and the game", async () => {
    await ingestAt(2 * HOUR, "old");
    await ingestAt(MINUTE, "other-game", 1, b.ingestKey);
    expect((await get("/v1/ingestion/servers?window=1h")).json().items).toEqual([]);
    expect((await get("/v1/ingestion/servers?window=24h")).json().items).toHaveLength(1);
  });
});

describe("ingestion endpoints: auth and validation", () => {
  it.each(["/v1/ingestion", "/v1/ingestion/servers"])("%s needs a read key", async (url) => {
    expect((await get(url, a.ingestKey)).statusCode).toBe(403);
    expect((await testApp(db).inject({ method: "GET", url })).statusCode).toBe(401);
  });

  it.each([
    "/v1/ingestion?window=2h",
    "/v1/ingestion?window=",
    "/v1/ingestion?extra=1",
    "/v1/ingestion/servers?window=30d",
    "/v1/ingestion/servers?limit=5",
  ])("rejects %s as invalid_schema", async (url) => {
    const res = await get(url);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_schema");
  });
});
