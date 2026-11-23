import type { FastifyInstance } from "fastify";
import type { Db } from "../db/pool.js";
import { displayPrefix, generateKey, hashKey } from "../lib/keys.js";
import type { TokenBucket } from "../lib/tokenBucket.js";
import { validate } from "../lib/validate.js";
import { authed, rateLimit, requireKey } from "../plugins/guards.js";
import { getGame, listAudit, listKeys, revokeKey, rotateKey } from "../repo/keys.js";
import { AuditQuery, EmptyBody, KeyParams, NoQuery, RotateBody } from "../schemas/queries.js";

/*
  Key management for one game: admin-scoped keys only, with their own rate-limit bucket.
  Every action writes one admin_audit row in the same transaction as the change itself, so
  there is never a change without its audit row (or an audit row for a change that rolled back).
*/
export function adminRoutes(db: Db, bucket: TokenBucket) {
  return async (app: FastifyInstance) => {
    app.addHook("onRequest", requireKey(db, "admin"));
    app.addHook("onRequest", rateLimit(bucket));
    // A new raw key is in the rotate response, and the rest describes keys: no browser or proxy
    // should keep a copy of any of it. Set on every reply here, errors included.
    app.addHook("onSend", async (_request, reply) => {
      reply.header("cache-control", "no-store");
    });

    // Which game this admin key manages, so the dashboard can refuse to show one game's keys
    // while it is showing another game's analytics.
    app.get("/v1/admin/game", async (request) => {
      validate(NoQuery, request.query);
      return { game: await getGame(db, authed(request).gameId) };
    });

    app.get("/v1/admin/keys", async (request) => {
      return { items: await listKeys(db, authed(request).gameId) };
    });

    app.post("/v1/admin/keys/rotate", async (request, reply) => {
      const { scope, graceHours } = validate(RotateBody, request.body);
      const actor = authed(request);
      const raw = generateKey();
      const result = await rotateKey(db, {
        gameId: actor.gameId,
        scope,
        keyHash: hashKey(raw),
        keyPrefix: displayPrefix(raw),
        graceHours,
        audit: { actorKeyId: actor.id, via: "api" },
      });
      if (result.status === "grace_in_progress") {
        return reply.code(409).send({
          error: "grace_in_progress",
          message: "an older key of this scope is still in its grace period; revoke it, wait, or rotate with graceHours 0",
          inGrace: result.inGrace,
        });
      }
      // The only time the raw key is ever sent anywhere. Only its hash was stored.
      return reply.code(201).send({
        key: raw,
        id: result.id,
        prefix: displayPrefix(raw),
        scope,
        createdAt: result.createdAt,
        graceHours,
        previous: result.previous,
      });
    });

    app.post("/v1/admin/keys/:id/revoke", async (request, reply) => {
      const { id } = validate(KeyParams, request.params);
      validate(EmptyBody, request.body);
      const actor = authed(request);
      const result = await revokeKey(db, actor.gameId, id, actor.id);
      switch (result.status) {
        case "ok":
          return { key: result.key };
        case "not_found": // includes another game's key
          return reply.code(404).send({ error: "not_found", message: "no such key in this game" });
        case "admin_key":
          return reply
            .code(403)
            .send({ error: "admin_key", message: "admin keys can't be revoked here; replace one with the create-key CLI" });
        case "already_revoked":
          return reply.code(409).send({ error: "already_revoked", message: "this key is already revoked" });
      }
    });

    app.get("/v1/admin/audit", async (request) => {
      const { limit, cursor } = validate(AuditQuery, request.query);
      const { items, next } = await listAudit(db, authed(request).gameId, { limit, cursor });
      return { items, nextCursor: next === null ? null : String(next) };
    });
  };
}
