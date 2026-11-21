import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { buildServer } from "./server.js";

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
const app = buildServer({ config, db });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
