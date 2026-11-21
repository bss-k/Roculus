/*
  Minimal migration runner.
  Applies every migrations/NNN_name.sql file not yet recorded in schema_migrations,
  in filename order, each inside its own transaction.
*/
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Db } from "./pool.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));

export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const { rows } = await db.query<{ name: string }>("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.name));
  const pending = (await readdir(dir)).filter((f) => f.endsWith(".sql") && !applied.has(f)).sort();

  for (const file of pending) {
    const sql = await readFile(path.join(dir, file), "utf8");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${file} failed: ${(err as Error).message}`, { cause: err });
    } finally {
      client.release();
    }
  }
  return pending;
}
