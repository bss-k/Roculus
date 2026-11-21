import type { FastifyInstance } from "fastify";
import { withSnapshot, type Db } from "../db/pool.js";
import type { TokenBucket } from "../lib/tokenBucket.js";
import { validate } from "../lib/validate.js";
import { timeWindow } from "../lib/windows.js";
import { authed, rateLimit, requireKey } from "../plugins/guards.js";
import { getRemote, listRemotes } from "../repo/remotes.js";
import { RemoteParams, RemotesQuery, WindowQuery } from "../schemas/queries.js";

// Remotes screen: read-scoped key, same per-key rate limit as the other dashboard endpoints.
export function remotesRoutes(db: Db, bucket: TokenBucket) {
  return async (app: FastifyInstance) => {
    app.addHook("onRequest", requireKey(db, "read"));
    app.addHook("onRequest", rateLimit(bucket));

    app.get("/v1/remotes", async (request) => {
      const { window, sort } = validate(RemotesQuery, request.query);
      // One snapshot for the rows, rule breakdowns and sparklines, so they agree with each other.
      const items = await withSnapshot(db, (q) => listRemotes(q, authed(request).gameId, timeWindow(window), sort));
      return { items };
    });

    app.get("/v1/remotes/:remote", async (request, reply) => {
      const { remote } = validate(RemoteParams, request.params);
      const { window } = validate(WindowQuery, request.query);
      const detail = await withSnapshot(db, (q) => getRemote(q, authed(request).gameId, remote, timeWindow(window)));
      // A plain 404, not a Rejection: asking about an unknown remote is not a bad request.
      if (!detail) return reply.code(404).send({ error: "not_found", message: "no events for this remote in this game" });
      return detail;
    });
  };
}
