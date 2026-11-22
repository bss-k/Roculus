import type { FastifyInstance } from "fastify";
import { loadConfig, type Config } from "../src/config.js";
import { createPool, type Db } from "../src/db/pool.js";
import { displayPrefix, generateKey, hashKey } from "../src/lib/keys.js";
import { insertEvents } from "../src/repo/events.js";
import { rotateKey, upsertGame, type KeyScope } from "../src/repo/keys.js";
import type { ViolationEvent } from "../src/schemas/events.js";
import { buildServer } from "../src/server.js";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://oculus:oculus@localhost:5432/oculus_test";

export function testDb(): Db {
  return createPool(TEST_DATABASE_URL);
}

export async function resetDb(db: Db): Promise<void> {
  await db.query("TRUNCATE games, api_keys, events, rejected_requests, admin_audit RESTART IDENTITY CASCADE");
}

export function testApp(db: Db, overrides: Partial<Config> = {}): FastifyInstance {
  const config = { ...loadConfig({ DATABASE_URL: TEST_DATABASE_URL }), ...overrides };
  return buildServer({ config, db, logger: false });
}

export async function mintKey(db: Db, gameId: string, scope: KeyScope): Promise<string> {
  const raw = generateKey();
  await rotateKey(db, { gameId, scope, keyHash: hashKey(raw), keyPrefix: displayPrefix(raw) });
  return raw;
}

let universe = 1000;
export async function createGame(db: Db, name = "Test Game") {
  const gameId = await upsertGame(db, name, universe++);
  return { gameId, ingestKey: await mintKey(db, gameId, "ingest"), readKey: await mintKey(db, gameId, "read") };
}

export function bearer(key: string) {
  return { authorization: `Bearer ${key}` };
}

export function makeEvent(overrides: Partial<ViolationEvent> = {}): ViolationEvent {
  return {
    timestamp: Date.now() - 1000,
    serverId: "server-1",
    playerId: 12345,
    playerName: "Builderman",
    remote: "Attack",
    rule: "Schema",
    detail: "targetId: expected integer, got string",
    mode: "shadow",
    ...overrides,
  };
}

// Writes events straight to the database, skipping the API's "last 24h" timestamp check, so a
// test can place events anywhere in time (e.g. 3 days ago for the 7d window).
export async function insertDirect(db: Db, gameId: string, events: ViolationEvent[]): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM api_keys WHERE game_id = $1 AND scope = 'ingest' AND revoked_at IS NULL",
    [gameId],
  );
  await insertEvents(db, { gameId, apiKeyId: rows[0]!.id }, events);
}

export async function rejections(db: Db) {
  const { rows } = await db.query<{ reason: string; api_key_id: string | null; detail: unknown }>(
    "SELECT reason, api_key_id, detail FROM rejected_requests ORDER BY id",
  );
  return rows;
}
