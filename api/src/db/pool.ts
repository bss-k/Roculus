import pg from "pg";

// bigint columns (player_id, counts) come back as strings by default; they fit in a JS number.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export type Db = pg.Pool;

// Anything that can run a query: the pool, or one connection taken from it.
export type Querier = Pick<pg.PoolClient, "query">;

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 10 });
}

/*
  Runs `fn` on one connection inside a read-only REPEATABLE READ transaction, so every query
  in it reads the same snapshot of the database. Without this, a response built from several
  queries (totals, breakdowns, buckets) could count an event that was committed halfway
  through in some of them and not others, and its numbers would stop adding up.
*/
export async function withSnapshot<T>(db: Db, fn: (q: Querier) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
