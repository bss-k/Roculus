import type { FastifyInstance } from "fastify";
import { withSnapshot, type Db } from "../db/pool.js";
import type { TokenBucket } from "../lib/tokenBucket.js";
import { validate } from "../lib/validate.js";
import { timeWindow } from "../lib/windows.js";
import { authed, rateLimit, requireKey } from "../plugins/guards.js";
import { ingestionOverview, ingestionServers, SILENT_AFTER_MINUTES } from "../repo/ingestion.js";
import { WindowQuery } from "../schemas/queries.js";

// Ingestion screen: read-scoped key, same per-key rate limit as the other dashboard endpoints.
export function ingestionRoutes(db: Db, bucket: TokenBucket) {
  return async (app: FastifyInstance) => {
    app.addHook("onRequest", requireKey(db, "read"));
    app.addHook("onRequest", rateLimit(bucket));

    app.get("/v1/ingestion", async (request) => {
      const { window } = validate(WindowQuery, request.query);
      // One snapshot, so the buckets and totals describe the same moment.
      return withSnapshot(db, (q) => ingestionOverview(q, authed(request).gameId, timeWindow(window)));
    });

    app.get("/v1/ingestion/servers", async (request) => {
      const { window } = validate(WindowQuery, request.query);
      const result = await ingestionServers(db, authed(request).gameId, timeWindow(window));
      return { ...result, silentAfterMinutes: SILENT_AFTER_MINUTES };
    });
  };
}
