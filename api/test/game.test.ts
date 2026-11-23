import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bearer, createGame, mintKey, resetDb, testApp, testDb } from "./helpers.js";

const db = testDb();
afterAll(() => db.end());

type Game = Awaited<ReturnType<typeof createGame>> & { adminKey: string; universeId: number };
let a: Game;
let b: Game;

async function game(name: string): Promise<Game> {
  const g = await createGame(db, name);
  const { rows } = await db.query<{ universe_id: number }>("SELECT universe_id FROM games WHERE id = $1", [g.gameId]);
  return { ...g, adminKey: await mintKey(db, g.gameId, "admin"), universeId: rows[0]!.universe_id };
}

beforeEach(async () => {
  await resetDb(db);
  a = await game("Game A");
  b = await game("Game B");
});

const get = (url: string, key: string) => testApp(db).inject({ method: "GET", url, headers: bearer(key) });

describe("GET /v1/game", () => {
  it("returns the read key's own game, and only that", async () => {
    const resA = await get("/v1/game", a.readKey);
    expect(resA.statusCode).toBe(200);
    expect(resA.json()).toEqual({ game: { name: "Game A", universeId: a.universeId } });
    expect((await get("/v1/game", b.readKey)).json()).toEqual({ game: { name: "Game B", universeId: b.universeId } });
  });

  it("refuses ingest and admin keys", async () => {
    for (const key of [a.ingestKey, a.adminKey]) expect((await get("/v1/game", key)).statusCode).toBe(403);
  });

  it("refuses query params", async () => {
    expect((await get("/v1/game?x=1", a.readKey)).statusCode).toBe(400);
  });
});

describe("GET /v1/admin/game", () => {
  it("returns the admin key's game, matching what its read key reports", async () => {
    const res = await get("/v1/admin/game", b.adminKey);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json()).toEqual((await get("/v1/game", b.readKey)).json());
  });
});
