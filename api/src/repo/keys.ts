import type { Db, Querier } from "../db/pool.js";

export type KeyScope = "ingest" | "read" | "admin";

export interface ActiveKey {
  id: string;
  gameId: string;
  scope: KeyScope;
}

// A key works until it is revoked or its expiry passes. Rotation sets expires_at on the old
// key, so it keeps working through the grace period, then stops on its own.
export const USABLE = `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`;

export type KeyLookup =
  | { status: "ok"; key: ActiveKey }
  | { status: "expired" | "revoked"; keyId: string } // a real key that no longer works
  | { status: "unknown" };

/*
  Finds the key for this hash. A usable key gets last_used_at stamped in the same round trip
  (the common case: one query). Only when that matches nothing does a second query tell an
  expired or revoked key apart from one that never existed.
*/
export async function lookupKey(db: Db, keyHash: Buffer): Promise<KeyLookup> {
  const used = await db.query<ActiveKey>(
    `UPDATE api_keys SET last_used_at = now()
     WHERE key_hash = $1 AND ${USABLE}
     RETURNING id, game_id AS "gameId", scope`,
    [keyHash],
  );
  if (used.rows[0]) return { status: "ok", key: used.rows[0] };

  const known = await db.query<{ id: string; revoked: boolean }>(
    "SELECT id, revoked_at IS NOT NULL AS revoked FROM api_keys WHERE key_hash = $1",
    [keyHash],
  );
  const row = known.rows[0];
  if (!row) return { status: "unknown" };
  return { status: row.revoked ? "revoked" : "expired", keyId: row.id };
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

export const MAX_GRACE_HOURS = 168; // 7 days

export interface PreviousKey {
  id: string;
  prefix: string;
  expiresAt: string;
}

export type RotateResult =
  | { status: "ok"; id: string; createdAt: string; previous: PreviousKey[] }
  // A grace rotation while an older key is still in its grace period would make three usable
  // keys. The caller decides: wait, revoke the old one, or rotate with graceHours 0.
  | { status: "grace_in_progress"; inGrace: PreviousKey };

export interface RotateInput {
  gameId: string;
  scope: KeyScope;
  keyHash: Buffer;
  keyPrefix: string;
  graceHours?: number; // default 0: the old keys stop working immediately
  // Write an admin_audit row. actorKeyId null = the create-key CLI.
  audit?: { actorKeyId: string | null; via: "api" | "cli" };
}

/*
  Creates a new key for a game and scope and retires the old one(s), in one transaction.

  Concurrency: two rotations at once must not both see "one usable key" and each add a new one
  (three usable keys). Locking the existing key rows with SELECT ... FOR UPDATE isn't enough on
  its own: the second transaction would wait for the first, but then re-check only the rows it
  already saw, not the new key the first one inserted. So the game's own row is locked first.
  That makes every rotation for a game wait its turn, and each one's next query (a new
  snapshot, in Postgres's default READ COMMITTED mode) sees everything the previous one committed.

  graceHours > 0: the newest usable key keeps working until now + grace (never later than an
                  expiry it already had). Refused if two keys are usable already.
  graceHours = 0: every old usable key expires now. Always allowed: this is also the
                  "key leaked, kill it" path.
*/
export async function rotateKey(db: Db, input: RotateInput): Promise<RotateResult> {
  const grace = input.graceHours ?? 0;
  if (!Number.isInteger(grace) || grace < 0 || grace > MAX_GRACE_HOURS) throw new Error(`invalid graceHours: ${grace}`);
  // One admin key per game (also enforced by the one_admin_key_per_game index).
  if (input.scope === "admin" && grace > 0) throw new Error("admin keys can't have a grace period");

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT 1 FROM games WHERE id = $1 FOR UPDATE", [input.gameId]);

    const usable = await client.query<{ id: string; prefix: string; expiresAt: Date | null }>(
      `SELECT id, key_prefix AS prefix, expires_at AS "expiresAt" FROM api_keys
       WHERE game_id = $1 AND scope = $2 AND ${USABLE}
       ORDER BY created_at DESC, id DESC
       FOR UPDATE`,
      [input.gameId, input.scope],
    );
    if (grace > 0 && usable.rows.length >= 2) {
      await client.query("ROLLBACK");
      const oldest = usable.rows.at(-1)!;
      return { status: "grace_in_progress", inGrace: { ...oldest, expiresAt: oldest.expiresAt!.toISOString() } };
    }

    // The newest old key gets the grace period; with grace 0 (or any older key) it ends now.
    const retired = await client.query<{ id: string; prefix: string; expiresAt: Date }>(
      `UPDATE api_keys
       SET expires_at = CASE WHEN id = $2 AND $3::int > 0
                             THEN least(coalesce(expires_at, 'infinity'), now() + $3::int * interval '1 hour')
                             ELSE now() END
       WHERE id = ANY($1::uuid[])
       RETURNING id, key_prefix AS prefix, expires_at AS "expiresAt"`,
      [usable.rows.map((r) => r.id), usable.rows[0]?.id ?? null, grace],
    );

    const created = await client.query<{ id: string; createdAt: Date }>(
      `INSERT INTO api_keys (game_id, scope, key_hash, key_prefix) VALUES ($1, $2, $3, $4)
       RETURNING id, created_at AS "createdAt"`,
      [input.gameId, input.scope, input.keyHash, input.keyPrefix],
    );
    const newKey = created.rows[0]!;
    const previous = retired.rows.map((r) => ({ id: r.id, prefix: r.prefix, expiresAt: r.expiresAt.toISOString() }));

    if (input.audit) {
      await client.query(
        `INSERT INTO admin_audit (game_id, actor_key_id, action, target_key_id, detail)
         VALUES ($1, $2, 'rotate', $3, $4)`,
        [
          input.gameId,
          input.audit.actorKeyId,
          newKey.id,
          JSON.stringify({ scope: input.scope, graceHours: grace, via: input.audit.via, previous }),
        ],
      );
    }
    await client.query("COMMIT");
    return { status: "ok", id: newKey.id, createdAt: newKey.createdAt.toISOString(), previous };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export type RevokeResult = { status: "ok"; key: KeyRow } | { status: "not_found" | "admin_key" | "already_revoked" };

// Revokes one key of this game, effective immediately, and audits it in the same transaction.
// Admin keys are refused: revoking the only admin key from the dashboard would lock everyone out.
export async function revokeKey(db: Db, gameId: string, keyId: string, actorKeyId: string): Promise<RevokeResult> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{ scope: KeyScope; revoked: boolean }>(
      "SELECT scope, revoked_at IS NOT NULL AS revoked FROM api_keys WHERE id = $1 AND game_id = $2 FOR UPDATE",
      [keyId, gameId],
    );
    const key = found.rows[0];
    // Another game's key is "not found", the same as one that doesn't exist: no hint it does.
    const refusal = !key ? "not_found" : key.scope === "admin" ? "admin_key" : key.revoked ? "already_revoked" : null;
    if (refusal) {
      await client.query("ROLLBACK");
      return { status: refusal };
    }
    await client.query("UPDATE api_keys SET revoked_at = now() WHERE id = $1", [keyId]);
    await client.query(
      `INSERT INTO admin_audit (game_id, actor_key_id, action, target_key_id, detail)
       VALUES ($1, $2, 'revoke', $3, $4)`,
      [gameId, actorKeyId, keyId, JSON.stringify({ scope: key!.scope })],
    );
    const updated = await listKeys(client, gameId, keyId);
    await client.query("COMMIT");
    return { status: "ok", key: updated[0]! };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export type KeyStatus = "active" | "expiring" | "expired" | "revoked";

// Everything about a key except its hash, which never leaves the database.
export interface KeyRow {
  id: string;
  prefix: string;
  scope: KeyScope;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  status: KeyStatus;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

// A game's keys (or one of them), newest first within each scope.
export async function listKeys(db: Querier, gameId: string, keyId?: string): Promise<KeyRow[]> {
  const { rows } = await db.query(
    `SELECT id, key_prefix AS prefix, scope, created_at AS "createdAt", last_used_at AS "lastUsedAt",
            expires_at AS "expiresAt", revoked_at AS "revokedAt",
            CASE WHEN revoked_at IS NOT NULL THEN 'revoked'
                 WHEN expires_at IS NULL THEN 'active'
                 WHEN expires_at > now() THEN 'expiring'
                 ELSE 'expired' END AS status
     FROM api_keys
     WHERE game_id = $1 AND ($2::uuid IS NULL OR id = $2)
     ORDER BY CASE scope WHEN 'ingest' THEN 0 WHEN 'read' THEN 1 ELSE 2 END, created_at DESC, id DESC`,
    [gameId, keyId ?? null],
  );
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: iso(r.lastUsedAt),
    expiresAt: iso(r.expiresAt),
    revokedAt: iso(r.revokedAt),
  }));
}

export interface AuditRow {
  id: number;
  at: string;
  action: "rotate" | "revoke";
  actor: { id: string; prefix: string } | null; // null: the create-key CLI
  target: { id: string; prefix: string; scope: KeyScope } | null;
  detail: unknown;
}

// Newest first, keyset-paged on id (ids only grow, so "id < cursor" is the next page).
export async function listAudit(
  db: Db,
  gameId: string,
  opts: { limit: number; cursor?: number },
): Promise<{ items: AuditRow[]; next: number | null }> {
  const { rows } = await db.query(
    `SELECT a.id, a.at, a.action, a.detail,
            actor.id AS "actorId", actor.key_prefix AS "actorPrefix",
            target.id AS "targetId", target.key_prefix AS "targetPrefix", target.scope AS "targetScope"
     FROM admin_audit a
     LEFT JOIN api_keys actor ON actor.id = a.actor_key_id
     LEFT JOIN api_keys target ON target.id = a.target_key_id
     WHERE a.game_id = $1 AND ($2::bigint IS NULL OR a.id < $2)
     ORDER BY a.id DESC
     LIMIT $3`,
    [gameId, opts.cursor ?? null, opts.limit + 1],
  );
  const items: AuditRow[] = rows.slice(0, opts.limit).map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    action: r.action,
    actor: r.actorId ? { id: r.actorId, prefix: r.actorPrefix } : null,
    target: r.targetId ? { id: r.targetId, prefix: r.targetPrefix, scope: r.targetScope } : null,
    detail: r.detail,
  }));
  return { items, next: rows.length > opts.limit ? items.at(-1)!.id : null };
}
