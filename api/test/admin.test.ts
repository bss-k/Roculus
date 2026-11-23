import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bearer, createGame, mintKey, rejections, resetDb, testApp, testDb } from "./helpers.js";

const db = testDb();
afterAll(() => db.end());

type Game = Awaited<ReturnType<typeof createGame>> & { adminKey: string };
let a: Game;
let b: Game;
beforeEach(async () => {
  await resetDb(db);
  const ga = await createGame(db, "Game A");
  a = { ...ga, adminKey: await mintKey(db, ga.gameId, "admin") };
  const gb = await createGame(db, "Game B");
  b = { ...gb, adminKey: await mintKey(db, gb.gameId, "admin") };
});

const app = () => testApp(db);
const get = (url: string, key = a.adminKey) => app().inject({ method: "GET", url, headers: bearer(key) });
const post = (url: string, payload?: object, key = a.adminKey) =>
  app().inject({ method: "POST", url, headers: bearer(key), ...(payload === undefined ? {} : { payload }) });
const rotate = (payload: object, key = a.adminKey) => post("/v1/admin/keys/rotate", payload, key);
const revoke = (id: string, key = a.adminKey) => post(`/v1/admin/keys/${id}/revoke`, undefined, key);

const auditRows = async () =>
  (await db.query("SELECT game_id, actor_key_id, action, target_key_id, detail FROM admin_audit ORDER BY id")).rows;

async function keyRow(gameId: string, scope: string) {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM api_keys WHERE game_id = $1 AND scope = $2 ORDER BY created_at DESC LIMIT 1",
    [gameId, scope],
  );
  return rows[0]!.id;
}

// Every stored hash, in the encodings a leak could plausibly use.
async function hashStrings() {
  const { rows } = await db.query<{ key_hash: Buffer }>("SELECT key_hash FROM api_keys");
  return rows.flatMap((r) => [r.key_hash.toString("hex"), r.key_hash.toString("base64"), r.key_hash.toString("base64url")]);
}

const ENDPOINTS: [string, string][] = [
  ["GET", "/v1/admin/game"],
  ["GET", "/v1/admin/keys"],
  ["POST", "/v1/admin/keys/rotate"],
  ["POST", "/v1/admin/keys/00000000-0000-4000-8000-000000000000/revoke"],
  ["GET", "/v1/admin/audit"],
];

describe("admin endpoints: auth", () => {
  it.each(ENDPOINTS)("%s %s refuses read and ingest keys with 403", async (method, url) => {
    for (const key of [a.readKey, a.ingestKey]) {
      const res = await app().inject({ method: method as "GET", url, headers: bearer(key), payload: method === "POST" ? {} : undefined });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: "bad_key", hint: "wrong_scope" });
    }
  });

  it.each(ENDPOINTS)("%s %s refuses no key with 401", async (method, url) => {
    expect((await app().inject({ method: method as "GET", url })).statusCode).toBe(401);
  });

  it("refuses an expired admin key", async () => {
    await db.query("UPDATE api_keys SET expires_at = now() WHERE scope = 'admin'");
    const res = await get("/v1/admin/keys");
    expect(res.statusCode).toBe(401);
    expect(res.json().hint).toBe("expired");
  });

  it("uses its own rate-limit bucket, separate from the read endpoints", async () => {
    const limited = testApp(db, { ADMIN_BURST: 1, ADMIN_PER_MINUTE: 1 });
    const adminGet = () => limited.inject({ method: "GET", url: "/v1/admin/keys", headers: bearer(a.adminKey) });
    expect((await adminGet()).statusCode).toBe(200);
    expect((await adminGet()).statusCode).toBe(429);
    const readRes = await limited.inject({ method: "GET", url: "/v1/stats/summary", headers: bearer(a.readKey) });
    expect(readRes.statusCode).toBe(200);
  });

  it("marks every admin response no-store, errors included", async () => {
    expect((await get("/v1/admin/keys")).headers["cache-control"]).toBe("no-store");
    expect((await rotate({ scope: "nope" })).headers["cache-control"]).toBe("no-store");
  });
});

describe("GET /v1/admin/keys", () => {
  it("lists the game's keys with a status, and never a hash", async () => {
    const readId = await keyRow(a.gameId, "read");
    const ingestId = await keyRow(a.gameId, "ingest");
    await db.query("UPDATE api_keys SET expires_at = now() + interval '1 hour' WHERE id = $1", [readId]);
    await db.query("UPDATE api_keys SET revoked_at = now() WHERE id = $1", [ingestId]);

    const res = await get("/v1/admin/keys");
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items).toHaveLength(3); // only game A's
    expect(Object.keys(items[0]).sort()).toEqual(
      ["createdAt", "expiresAt", "id", "lastUsedAt", "prefix", "revokedAt", "scope", "status"].sort(),
    );
    const statusOf = (scope: string) => items.find((k: { scope: string }) => k.scope === scope).status;
    expect(statusOf("ingest")).toBe("revoked");
    expect(statusOf("read")).toBe("expiring");
    expect(statusOf("admin")).toBe("active");
    for (const h of await hashStrings()) expect(res.body).not.toContain(h);
  });

  it("shows expired keys as expired", async () => {
    await db.query("UPDATE api_keys SET expires_at = now() - interval '1 minute' WHERE scope = 'read'");
    const items = (await get("/v1/admin/keys")).json().items;
    expect(items.find((k: { scope: string }) => k.scope === "read").status).toBe("expired");
  });
});

describe("POST /v1/admin/keys/rotate", () => {
  it("returns the new raw key once, gives the old key a 24h grace by default, and audits it", async () => {
    const oldId = await keyRow(a.gameId, "read");
    const res = await rotate({ scope: "read" });
    expect(res.statusCode).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json();
    expect(body.key).toMatch(/^ocl_/);
    expect(body).toMatchObject({ scope: "read", graceHours: 24, prefix: body.key.slice(0, 10) });
    expect(body.previous).toHaveLength(1);
    expect(body.previous[0].id).toBe(oldId);
    expect(Date.parse(body.previous[0].expiresAt) - Date.now()).toBeGreaterThan(23.9 * 3600_000);

    // Both keys work during the grace period.
    for (const key of [a.readKey, body.key]) {
      const r = await app().inject({ method: "GET", url: "/v1/stats/summary", headers: bearer(key) });
      expect(r.statusCode).toBe(200);
    }

    const audit = await auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      game_id: a.gameId,
      actor_key_id: await keyRow(a.gameId, "admin"),
      action: "rotate",
      target_key_id: body.id,
      detail: { scope: "read", graceHours: 24, via: "api" },
    });
    expect(JSON.stringify(audit)).not.toContain(body.key);
    for (const h of await hashStrings()) expect(res.body).not.toContain(h);
  });

  it("never shows the raw key again: not in the key list, not in the audit log", async () => {
    const { key } = (await rotate({ scope: "ingest", graceHours: 0 })).json();
    expect((await get("/v1/admin/keys")).body).not.toContain(key);
    expect((await get("/v1/admin/audit")).body).not.toContain(key);
    const { rows } = await db.query("SELECT * FROM api_keys");
    expect(JSON.stringify(rows)).not.toContain(key);
  });

  it("with graceHours 0 ends the old key immediately", async () => {
    await rotate({ scope: "ingest", graceHours: 0 });
    const res = await app().inject({ method: "POST", url: "/v1/events", headers: bearer(a.ingestKey), payload: { events: [] } });
    expect(res.statusCode).toBe(401);
    expect(res.json().hint).toBe("expired");
  });

  it("refuses a second grace rotation with 409 and writes no audit row", async () => {
    expect((await rotate({ scope: "read", graceHours: 24 })).statusCode).toBe(201);
    const res = await rotate({ scope: "read", graceHours: 1 });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "grace_in_progress" });
    expect(res.json().inGrace.id).toBeTruthy();
    expect(await auditRows()).toHaveLength(1);
  });

  it("only rotates the admin key's own game", async () => {
    await rotate({ scope: "read", graceHours: 0 });
    const bRead = await app().inject({ method: "GET", url: "/v1/stats/summary", headers: bearer(b.readKey) });
    expect(bRead.statusCode).toBe(200);
  });

  it.each([
    ["an admin scope", { scope: "admin" }],
    ["an unknown scope", { scope: "write" }],
    ["no scope", { graceHours: 1 }],
    ["graceHours above 7 days", { scope: "read", graceHours: 169 }],
    ["negative graceHours", { scope: "read", graceHours: -1 }],
    ["fractional graceHours", { scope: "read", graceHours: 1.5 }],
    ["graceHours as a string", { scope: "read", graceHours: "24" }],
    ["an unknown field", { scope: "read", graceHours: 1, keyHash: "x" }],
  ])("rejects %s as invalid_schema, with no change and no audit row", async (_name, payload) => {
    const before = (await db.query("SELECT count(*) AS n FROM api_keys")).rows[0].n;
    const res = await rotate(payload);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_schema");
    expect((await db.query("SELECT count(*) AS n FROM api_keys")).rows[0].n).toBe(before);
    expect(await auditRows()).toHaveLength(0);
    expect((await rejections(db)).map((r) => r.reason)).toEqual(["invalid_schema"]);
  });
});

describe("POST /v1/admin/keys/:id/revoke", () => {
  it("revokes immediately and writes exactly one audit row", async () => {
    const id = await keyRow(a.gameId, "ingest");
    const res = await revoke(id);
    expect(res.statusCode).toBe(200);
    expect(res.json().key).toMatchObject({ id, status: "revoked" });
    const ingest = await app().inject({ method: "POST", url: "/v1/events", headers: bearer(a.ingestKey), payload: { events: [] } });
    expect(ingest.statusCode).toBe(401);
    const audit = await auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "revoke", target_key_id: id, detail: { scope: "ingest" } });
  });

  it("refuses to revoke an admin key, with no audit row", async () => {
    const res = await revoke(await keyRow(a.gameId, "admin"));
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("admin_key");
    expect((await get("/v1/admin/keys")).statusCode).toBe(200); // still works
    expect(await auditRows()).toHaveLength(0);
  });

  it("answers 404 for another game's key and leaves it alone", async () => {
    const bIngest = await keyRow(b.gameId, "ingest");
    expect((await revoke(bIngest)).statusCode).toBe(404);
    const stillWorks = await app().inject({ method: "POST", url: "/v1/events", headers: bearer(b.ingestKey), payload: { events: [] } });
    expect(stillWorks.statusCode).toBe(400); // auth passed; only the empty batch is refused
    expect(await auditRows()).toHaveLength(0);
  });

  it("answers 404 for a key that doesn't exist", async () => {
    expect((await revoke("00000000-0000-4000-8000-000000000000")).statusCode).toBe(404);
  });

  it("answers 409 for a key that's already revoked", async () => {
    const id = await keyRow(a.gameId, "read");
    await revoke(id);
    expect((await revoke(id)).statusCode).toBe(409);
    expect(await auditRows()).toHaveLength(1);
  });

  it("can revoke a key that's in its grace period", async () => {
    const oldId = await keyRow(a.gameId, "read");
    await rotate({ scope: "read", graceHours: 24 });
    expect((await revoke(oldId)).statusCode).toBe(200);
    const r = await app().inject({ method: "GET", url: "/v1/stats/summary", headers: bearer(a.readKey) });
    expect(r.statusCode).toBe(401);
  });

  it.each(["not-a-uuid", "1", "00000000-0000-4000-8000-00000000000g"])("rejects id %s as invalid_schema", async (id) => {
    const res = await revoke(id);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_schema");
  });

  it("rejects a body with fields", async () => {
    const res = await post(`/v1/admin/keys/${await keyRow(a.gameId, "read")}/revoke`, { reason: "x" });
    expect(res.statusCode).toBe(400);
    expect(await auditRows()).toHaveLength(0);
  });

  it("accepts an empty JSON body", async () => {
    expect((await post(`/v1/admin/keys/${await keyRow(a.gameId, "read")}/revoke`, {})).statusCode).toBe(200);
  });
});

describe("GET /v1/admin/audit", () => {
  it("lists the game's actions newest first with keyset paging", async () => {
    await rotate({ scope: "ingest", graceHours: 0 });
    await rotate({ scope: "read", graceHours: 0 });
    await revoke(await keyRow(a.gameId, "ingest"));
    await rotate({ scope: "read", graceHours: 0 }, b.adminKey); // game B: never in A's list

    const first = (await get("/v1/admin/audit?limit=2")).json();
    expect(first.items.map((i: { action: string }) => i.action)).toEqual(["revoke", "rotate"]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await get(`/v1/admin/audit?limit=2&cursor=${first.nextCursor}`)).json();
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    const all = [...first.items, ...second.items];
    expect(new Set(all.map((i: { id: number }) => i.id)).size).toBe(3);
    expect(all[0]).toMatchObject({ action: "revoke", actor: { prefix: expect.any(String) }, target: { scope: "ingest" } });
    for (const h of await hashStrings()) expect(JSON.stringify(all)).not.toContain(h);
  });

  it("shows CLI actions with no actor", async () => {
    await db.query(
      `INSERT INTO admin_audit (game_id, actor_key_id, action, target_key_id, detail)
       VALUES ($1, NULL, 'rotate', $2, '{"via":"cli"}')`,
      [a.gameId, await keyRow(a.gameId, "read")],
    );
    expect((await get("/v1/admin/audit")).json().items[0]).toMatchObject({ actor: null, detail: { via: "cli" } });
  });

  it.each(["limit=0", "limit=101", "limit=x", "cursor=abc", "cursor=-1", "cursor=1.5", "extra=1"])(
    "rejects %s as invalid_schema",
    async (qs) => {
      const res = await get(`/v1/admin/audit?${qs}`);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_schema");
    },
  );
});
