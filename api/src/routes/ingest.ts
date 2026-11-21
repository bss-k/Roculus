import type { FastifyInstance } from "fastify";
import type { Db } from "../db/pool.js";
import type { TokenBucket } from "../lib/tokenBucket.js";
import { validate } from "../lib/validate.js";
import { authed, rateLimit, requireKey } from "../plugins/guards.js";
import { insertEvents } from "../repo/events.js";
import { EventBatch } from "../schemas/events.js";

export function ingestRoutes(db: Db, bucket: TokenBucket) {
  return async (app: FastifyInstance) => {
    app.post(
      "/v1/events",
      { onRequest: [requireKey(db, "ingest"), rateLimit(bucket)] },
      async (request, reply) => {
        const { events } = validate(EventBatch, request.body);
        const key = authed(request);
        const accepted = await insertEvents(db, { gameId: key.gameId, apiKeyId: key.id }, events);
        return reply.code(202).send({ accepted });
      },
    );
  };
}
