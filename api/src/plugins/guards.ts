/*
  Route guards, run as onRequest hooks (before the body is even read):
    requireKey(scope)  -> Authorization: Bearer <key>, must be active and have this scope
    rateLimit(bucket)  -> one token per request, per key
*/
import type { FastifyRequest, onRequestAsyncHookHandler } from "fastify";
import type { Db } from "../db/pool.js";
import { hashKey, parseBearer } from "../lib/keys.js";
import { Rejection } from "../lib/rejection.js";
import type { TokenBucket } from "../lib/tokenBucket.js";
import { useActiveKey, type ActiveKey, type KeyScope } from "../repo/keys.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: ActiveKey | null;
  }
}

export function requireKey(db: Db, scope: KeyScope): onRequestAsyncHookHandler {
  return async (request) => {
    const raw = parseBearer(request.headers.authorization);
    if (!raw) throw new Rejection("bad_key", 401, "missing or malformed bearer token", { hint: "malformed" });

    const key = await useActiveKey(db, hashKey(raw));
    if (!key) throw new Rejection("bad_key", 401, "unknown or revoked key", { hint: "unknown_or_revoked" });

    request.auth = key;
    if (key.scope !== scope) {
      throw new Rejection("bad_key", 403, `this endpoint needs a ${scope} key`, { hint: "wrong_scope" });
    }
  };
}

export function rateLimit(bucket: TokenBucket): onRequestAsyncHookHandler {
  return async (request) => {
    const { ok, retryAfterSeconds } = bucket.take(authed(request).id);
    if (!ok) {
      throw new Rejection("rate_limited", 429, "rate limit exceeded", undefined, {
        "retry-after": String(retryAfterSeconds),
      });
    }
  };
}

// For handlers behind requireKey: the key is guaranteed to be set.
export function authed(request: FastifyRequest): ActiveKey {
  if (!request.auth) throw new Error("route is missing requireKey()");
  return request.auth;
}
