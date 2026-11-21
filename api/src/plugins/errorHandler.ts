/*
  One place where refused requests are answered and recorded.
  Our own Rejections, Fastify's body-size error and its JSON/content-type parse errors all map
  to a reason, get a rejected_requests row, and a small JSON reply. Anything else is a 500.

  Logging is itself rate limited per (reason, ip): a flood of bad requests must not be able to
  fill the rejected_requests table.
*/
import type { FastifyError, FastifyInstance, FastifyRequest } from "fastify";
import type { Db } from "../db/pool.js";
import { Rejection } from "../lib/rejection.js";
import { createTokenBucket } from "../lib/tokenBucket.js";
import { insertRejection } from "../repo/rejections.js";

function toRejection(error: FastifyError | Rejection, bodyLimit: number): Rejection | null {
  if (error instanceof Rejection) return error;
  if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
    return new Rejection("too_large", 413, `body exceeds ${bodyLimit} bytes`);
  }
  if (error.code?.startsWith("FST_ERR_CTP_") || error.statusCode === 400) {
    // Bad JSON, wrong content type, prototype-poisoning keys, empty body...
    return new Rejection("invalid_schema", error.statusCode ?? 400, "malformed request body", { code: error.code });
  }
  return null;
}

export function registerErrorHandler(app: FastifyInstance, db: Db, bodyLimit: number): void {
  const logBudget = createTokenBucket({ capacity: 20, refillPerSecond: 20 / 60 });

  async function record(request: FastifyRequest, rejection: Rejection) {
    if (!logBudget.take(`${rejection.reason}:${request.ip}`).ok) return;
    try {
      await insertRejection(db, {
        reason: rejection.reason,
        apiKeyId: request.auth?.id ?? null,
        ip: request.ip,
        route: request.routeOptions.url ?? request.url,
        detail: rejection.detail,
      });
    } catch (err) {
      request.log.error({ err }, "failed to record rejection");
    }
  }

  app.setErrorHandler<FastifyError | Rejection>(async (error, request, reply) => {
    const rejection = toRejection(error, bodyLimit);
    if (!rejection) {
      request.log.error({ err: error }, "unhandled error");
      return reply.code(500).send({ error: "internal_error" });
    }
    await record(request, rejection);
    return reply
      .code(rejection.statusCode)
      .headers(rejection.headers)
      .send({ error: rejection.reason, message: rejection.message, ...(rejection.detail as object | undefined) });
  });
}
