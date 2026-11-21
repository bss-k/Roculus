import type { FastifyInstance } from "fastify";
import { withSnapshot, type Db } from "../db/pool.js";
import type { TokenBucket } from "../lib/tokenBucket.js";
import { validate } from "../lib/validate.js";
import { timeWindow } from "../lib/windows.js";
import { authed, rateLimit, requireKey } from "../plugins/guards.js";
import { getPlayer, listPlayers } from "../repo/players.js";
import { MAX_PLAYERS_OFFSET, PlayerParams, PlayersQuery, WindowQuery } from "../schemas/queries.js";

// Players screen: read-scoped key, same per-key rate limit as the other dashboard endpoints.
export function playersRoutes(db: Db, bucket: TokenBucket) {
  return async (app: FastifyInstance) => {
    app.addHook("onRequest", requireKey(db, "read"));
    app.addHook("onRequest", rateLimit(bucket));

    app.get("/v1/players", async (request) => {
      const { window, ...opts } = validate(PlayersQuery, request.query);
      // One snapshot for the page and its details query, so a row's rules match its counts.
      const { items, hasMore } = await withSnapshot(db, (q) =>
        listPlayers(q, authed(request).gameId, timeWindow(window), opts),
      );
      // Never hand out an offset the schema would refuse.
      const next = opts.offset + opts.limit;
      return { items, nextOffset: hasMore && next <= MAX_PLAYERS_OFFSET ? next : null };
    });

    app.get("/v1/players/:playerId", async (request, reply) => {
      const { playerId } = validate(PlayerParams, request.params);
      const { window } = validate(WindowQuery, request.query);
      // One snapshot for all of the response's queries, so its totals, breakdowns and buckets agree.
      const detail = await withSnapshot(db, (q) => getPlayer(q, authed(request).gameId, playerId, timeWindow(window)));
      // A plain 404, not a Rejection: asking about an unknown player is not a bad request.
      if (!detail) return reply.code(404).send({ error: "not_found", message: "no events for this player in this game" });
      return detail;
    });
  };
}
