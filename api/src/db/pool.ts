import pg from "pg";

// bigint columns (player_id, counts) come back as strings by default; they fit in a JS number.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export type Db = pg.Pool;

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 10 });
}
