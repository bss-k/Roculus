import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import type { Db } from "./db/pool.js";
import { createTokenBucket } from "./lib/tokenBucket.js";
import { registerErrorHandler } from "./plugins/errorHandler.js";
import { adminRoutes } from "./routes/admin.js";
import { ingestRoutes } from "./routes/ingest.js";
import { ingestionRoutes } from "./routes/ingestion.js";
import { playersRoutes } from "./routes/players.js";
import { remotesRoutes } from "./routes/remotes.js";
import { statsRoutes } from "./routes/stats.js";

export interface ServerDeps {
  config: Config;
  db: Db;
  logger?: boolean;
}

const perSecond = (perMinute: number) => perMinute / 60;

export function buildServer({ config, db, logger = true }: ServerDeps): FastifyInstance {
  const app = Fastify({
    logger,
    bodyLimit: config.BODY_LIMIT_BYTES,
    trustProxy: config.TRUST_PROXY,
    // Fastify refuses path params over 100 decoded chars itself (414, during routing: before
    // auth and our error handler). Remote names can be 100 chars, so allow more and let the
    // Zod schemas reject anything too long as a logged invalid_schema.
    routerOptions: { maxParamLength: 512 },
  });
  app.decorateRequest("auth", null);
  registerErrorHandler(app, db, config.BODY_LIMIT_BYTES);

  const ingestBucket = createTokenBucket({
    capacity: config.INGEST_BURST,
    refillPerSecond: perSecond(config.INGEST_PER_MINUTE),
  });

  const readBucket = createTokenBucket({
    capacity: config.READ_BURST,
    refillPerSecond: perSecond(config.READ_PER_MINUTE),
  });

  const adminBucket = createTokenBucket({
    capacity: config.ADMIN_BURST,
    refillPerSecond: perSecond(config.ADMIN_PER_MINUTE),
  });

  app.get("/healthz", async () => ({ ok: true }));
  app.register(ingestRoutes(db, ingestBucket));
  app.register(statsRoutes(db, readBucket));
  app.register(playersRoutes(db, readBucket));
  app.register(remotesRoutes(db, readBucket));
  app.register(ingestionRoutes(db, readBucket));
  app.register(adminRoutes(db, adminBucket));

  return app;
}
