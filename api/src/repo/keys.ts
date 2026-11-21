import type { Db } from "../db/pool.js";

export type KeyScope = "ingest" | "read";

export interface ActiveKey {
  id: string;
  gameId: string;
  scope: KeyScope;
}

// Looks up an active key by hash and stamps last_used_at in the same round trip.
export async function useActiveKey(db: Db, keyHash: Buffer): Promise<ActiveKey | null> {
  const { rows } = await db.query<ActiveKey>(
    `UPDATE api_keys SET last_used_at = now()
     WHERE key_hash = $1 AND revoked_at IS NULL
     RETURNING id, game_id AS "gameId", scope`,
    [keyHash],
  );
  return rows[0] ?? null;
}

export async function upsertGame(db: Db, name: string, universeId: number): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO games (name, universe_id) VALUES ($1, $2)
     ON CONFLICT (universe_id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name, universeId],
  );
  return rows[0]!.id;
}

// Revokes the game's current key for this scope (if any) and stores the new one, atomically.
export async function rotateKey(
  db: Db,
  input: { gameId: string; scope: KeyScope; keyHash: Buffer; keyPrefix: string },
): Promise<{ revoked: number }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const revoked = await client.query(
      "UPDATE api_keys SET revoked_at = now() WHERE game_id = $1 AND scope = $2 AND revoked_at IS NULL",
      [input.gameId, input.scope],
    );
    await client.query(
      "INSERT INTO api_keys (game_id, scope, key_hash, key_prefix) VALUES ($1, $2, $3, $4)",
      [input.gameId, input.scope, input.keyHash, input.keyPrefix],
    );
    await client.query("COMMIT");
    return { revoked: revoked.rowCount ?? 0 };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
