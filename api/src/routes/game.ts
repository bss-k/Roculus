import type { FastifyInstance } from "fastify";
import type { Db } from "../db/pool.js";
import type { TokenBucket } from "../lib/tokenBucket.js";
import { validate } from "../lib/validate.js";
import { authed, rateLimit, requireKey } from "../plugins/guards.js";
import { getGame } from "../repo/keys.js";
import { NoQuery } from "../schemas/queries.js";

// The read key's game (name and universe ID): the dashboard's game picker shows these, and
// the key screen compares them with the admin key's game.
export function gameRoutes(db: Db, bucket: TokenBucket) {
  return async (app: FastifyInstance) => {
    app.addHook("onRequest", requireKey(db, "read"));
    app.addHook("onRequest", rateLimit(bucket));

    app.get("/v1/game", async (request) => {
      validate(NoQuery, request.query);
      return { game: await getGame(db, authed(request).gameId) };
    });
  };
}
