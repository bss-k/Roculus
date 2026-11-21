import type { FastifyInstance } from "fastify";
import type { Db } from "../db/pool.js";
import type { TokenBucket } from "../lib/tokenBucket.js";
import { validate } from "../lib/validate.js";
import { authed, rateLimit, requireKey } from "../plugins/guards.js";
import { hourly, listViolations, summary, topRemotes } from "../repo/stats.js";
import { encodeCursor, NoQuery, TopRemotesQuery, ViolationsQuery } from "../schemas/queries.js";

// Dashboard endpoints: need a read-scoped key, and only ever see that key's game.
export function statsRoutes(db: Db, bucket: TokenBucket) {
  return async (app: FastifyInstance) => {
    app.addHook("onRequest", requireKey(db, "read"));
    app.addHook("onRequest", rateLimit(bucket));

    app.get("/v1/stats/summary", async (request) => {
      validate(NoQuery, request.query);
      return summary(db, authed(request).gameId);
    });

    app.get("/v1/stats/hourly", async (request) => {
      validate(NoQuery, request.query);
      return { hours: await hourly(db, authed(request).gameId) };
    });

    app.get("/v1/stats/top-remotes", async (request) => {
      const { limit } = validate(TopRemotesQuery, request.query);
      return { remotes: await topRemotes(db, authed(request).gameId, limit) };
    });

    app.get("/v1/violations", async (request) => {
      const query = validate(ViolationsQuery, request.query);
      const { items, next } = await listViolations(db, authed(request).gameId, query);
      return { items, nextCursor: next ? encodeCursor(next) : null };
    });
  };
}
