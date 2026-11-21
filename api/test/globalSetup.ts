import { createPool } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";
import { TEST_DATABASE_URL } from "./helpers.js";

// Runs once before all test files: bring the test database schema up to date.
export async function setup() {
  const db = createPool(TEST_DATABASE_URL);
  try {
    await migrate(db);
  } finally {
    await db.end();
  }
}
