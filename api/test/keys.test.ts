import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { displayPrefix, generateKey, hashKey } from "../src/lib/keys.js";
import { rotateKey, type KeyScope } from "../src/repo/keys.js";
import { bearer, createGame, mintKey, rejections, resetDb, testApp, testDb } from "./helpers.js";

const db = testDb();
afterAll(() => db.end());

let keys: Awaited<ReturnType<typeof createGame>>;
beforeEach(async () => {
  await resetDb(db);
  keys = await createGame(db);
});

// Any read endpoint will do to check whether a key works.
const read = (key: string) => testApp(db).inject({ method: "GET", url: "/v1/stats/summary", headers: bearer(key) });

async function rotate(scope: KeyScope, graceHours: number) {
  const raw = generateKey();
  const result = await rotateKey(db, { gameId: keys.gameId, scope, keyHash: hashKey(raw), keyPrefix: displayPrefix(raw), graceHours });
  return { raw, result };
}

async function usableCount(scope: KeyScope) {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*) AS n FROM api_keys
     WHERE game_id = $1 AND scope = $2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [keys.gameId, scope],
  );
  return rows[0]!.n;
}

describe("key expiry", () => {
  it("works before expires_at", async () => {
    await db.query("UPDATE api_keys SET expires_at = now() + interval '1 minute' WHERE scope = 'read'");
    expect((await read(keys.readKey)).statusCode).toBe(200);
  });

  it("is refused after expires_at with 401 and hint 'expired'", async () => {
    await db.query("UPDATE api_keys SET expires_at = now() - interval '1 second' WHERE scope = 'read'");
    const res = await read(keys.readKey);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "bad_key", hint: "expired" });
  });

  it("logs the refusal against the expired key, so its game can see it", async () => {
    const { rows } = await db.query<{ id: string }>("UPDATE api_keys SET expires_at = now() WHERE scope = 'read' RETURNING id");
    await read(keys.readKey);
    const logged = await rejections(db);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ reason: "bad_key", api_key_id: rows[0]!.id });
  });

  it("still says unknown_or_revoked for a revoked key", async () => {
    await db.query("UPDATE api_keys SET revoked_at = now() WHERE scope = 'read'");
    const res = await read(keys.readKey);
    expect(res.statusCode).toBe(401);
    expect(res.json().hint).toBe("unknown_or_revoked");
  });
});

describe("rotation", () => {
  it("keeps both keys usable inside the grace period", async () => {
    const { raw, result } = await rotate("read", 24);
    expect(result.status).toBe("ok");
    expect((await read(keys.readKey)).statusCode).toBe(200);
    expect((await read(raw)).statusCode).toBe(200);

    // The old key's expiry is now + 24h (give or take the test's own runtime).
    const previous = result.status === "ok" ? result.previous : [];
    expect(previous).toHaveLength(1);
    const hoursLeft = (Date.parse(previous[0]!.expiresAt) - Date.now()) / 3600_000;
    expect(hoursLeft).toBeGreaterThan(23.9);
    expect(hoursLeft).toBeLessThanOrEqual(24);
  });

  it("stops the old key once the grace period is over", async () => {
    const { raw } = await rotate("read", 24);
    await db.query("UPDATE api_keys SET expires_at = now() - interval '1 second' WHERE expires_at IS NOT NULL");
    expect((await read(keys.readKey)).json().hint).toBe("expired");
    expect((await read(raw)).statusCode).toBe(200);
  });

  it("with graceHours 0 kills the old key immediately", async () => {
    const { raw } = await rotate("read", 0);
    expect((await read(keys.readKey)).statusCode).toBe(401);
    expect((await read(raw)).statusCode).toBe(200);
    expect(await usableCount("read")).toBe(1);
  });

  it("only touches the rotated scope", async () => {
    await rotate("read", 0);
    const ingest = await testApp(db).inject({
      method: "POST",
      url: "/v1/events",
      headers: bearer(keys.ingestKey),
      payload: { events: [] },
    });
    expect(ingest.statusCode).toBe(400); // auth passed (an empty batch is the only problem)
  });

  it("never makes a third usable key: a second grace rotation is refused", async () => {
    await rotate("read", 24);
    const second = await rotate("read", 24);
    expect(second.result.status).toBe("grace_in_progress");
    expect(await usableCount("read")).toBe(2);
    expect((await read(second.raw)).statusCode).toBe(401); // never stored
  });

  it("allows a graceHours 0 rotation while a key is in grace, ending both old keys", async () => {
    await rotate("read", 24);
    const { raw, result } = await rotate("read", 0);
    expect(result.status === "ok" && result.previous).toHaveLength(2);
    expect(await usableCount("read")).toBe(1);
    expect((await read(raw)).statusCode).toBe(200);
  });

  it("never extends an expiry the old key already had", async () => {
    await db.query("UPDATE api_keys SET expires_at = now() + interval '1 hour' WHERE scope = 'read'");
    const { result } = await rotate("read", 48);
    const expiresAt = result.status === "ok" ? Date.parse(result.previous[0]!.expiresAt) : 0;
    expect(expiresAt - Date.now()).toBeLessThan(3600_000 + 1000);
  });

  it("refuses an out-of-range grace period", async () => {
    await expect(rotate("read", 169)).rejects.toThrow(/graceHours/);
    await expect(rotate("read", -1)).rejects.toThrow(/graceHours/);
    await expect(rotate("read", 1.5)).rejects.toThrow(/graceHours/);
  });

  it("keeps one admin key per game: rotating replaces it, a grace period is refused", async () => {
    const first = await mintKey(db, keys.gameId, "admin");
    await expect(rotate("admin", 1)).rejects.toThrow(/admin/);
    const second = await mintKey(db, keys.gameId, "admin");
    expect(await usableCount("admin")).toBe(1);
    // On a read endpoint: 401 = the key no longer works, 403 = it works but is the wrong scope.
    expect((await read(first)).json().hint).toBe("expired");
    expect((await read(second)).statusCode).toBe(403);
  });

  it("is rejected by the database if a second admin key is inserted directly", async () => {
    await mintKey(db, keys.gameId, "admin");
    await expect(
      db.query("INSERT INTO api_keys (game_id, scope, key_hash, key_prefix) VALUES ($1, 'admin', $2, 'x')", [
        keys.gameId,
        hashKey(generateKey()),
      ]),
    ).rejects.toThrow(/one_admin_key_per_game/);
  });
});

describe("rotation under concurrency", () => {
  it("leaves at most 2 usable keys when rotations with a grace period race", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => rotate("read", 24)));
    expect(await usableCount("read")).toBe(2);
    // Exactly one of them won; the others saw a key already in grace and were refused.
    expect(results.filter((r) => r.result.status === "ok")).toHaveLength(1);
  });

  it("leaves exactly 1 usable key when graceHours 0 rotations race", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => rotate("read", 0)));
    expect(results.every((r) => r.result.status === "ok")).toBe(true);
    expect(await usableCount("read")).toBe(1);
    // ...and it is the last one to commit.
    const working = await Promise.all(results.map(async (r) => (await read(r.raw)).statusCode === 200));
    expect(working.filter(Boolean)).toHaveLength(1);
  });

  it("stays at most 2 with mixed grace periods racing", async () => {
    await Promise.all([0, 24, 0, 48, 24, 0, 1].map((h) => rotate("read", h)));
    expect(await usableCount("read")).toBeLessThanOrEqual(2);
  });
});
