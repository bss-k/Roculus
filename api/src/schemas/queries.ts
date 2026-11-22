import { z } from "zod";
import { WINDOW_IDS } from "../lib/windows.js";
import { MAX_GRACE_HOURS } from "../repo/keys.js";
import type { Cursor } from "../repo/stats.js";

// Query strings arrive as text, so numbers are coerced. Every schema is strict.
export const NoQuery = z.strictObject({});

// Shared by the Players and Remotes endpoints.
export const windowParam = z.enum(WINDOW_IDS).default("24h");

export const WindowQuery = z.strictObject({ window: windowParam });

// Path params are always strings. Digits only (no "1e3", no spaces), then range-checked.
const playerIdParam = z
  .string()
  .regex(/^\d{1,16}$/, "expected a numeric player id")
  .transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));

export const MAX_PLAYERS_OFFSET = 1000;

export const PlayersQuery = z.strictObject({
  window: windowParam,
  sort: z.enum(["total", "enforced", "lastSeen"]).default("total"),
  q: z.string().min(1).max(32).optional(), // name prefix, or an exact player id if all digits
  limit: z.coerce.number().int().min(1).max(50).default(25),
  offset: z.coerce.number().int().min(0).max(MAX_PLAYERS_OFFSET).default(0),
});

export const PlayerParams = z.strictObject({ playerId: playerIdParam });

export const TopRemotesQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

const CursorJson = z.tuple([z.iso.datetime(), z.number().int().positive()]);

// Opaque to clients: base64url of [occurredAt, id].
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.occurredAt, cursor.id])).toString("base64url");
}

const cursorParam = z
  .string()
  .max(200)
  .transform((value, ctx): Cursor => {
    try {
      const [occurredAt, id] = CursorJson.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
      return { occurredAt, id };
    } catch {
      ctx.addIssue({ code: "custom", message: "invalid cursor" });
      return z.NEVER;
    }
  });

// Same limit as the ingest schema (schemas/events.ts).
const remoteName = z.string().min(1).max(100);

export const ViolationsQuery = z.strictObject({
  rule: z.string().min(1).max(64).optional(),
  playerId: playerIdParam.optional(),
  remote: remoteName.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: cursorParam.optional(),
});

export const RemotesQuery = z.strictObject({
  window: windowParam,
  sort: z.enum(["total", "enforced", "uniquePlayers"]).default("total"),
});

// Fastify has already URL-decoded the path param, so this is the real name's length.
export const RemoteParams = z.strictObject({ remote: remoteName });

// Admin endpoints (Milestone 3).

// Only ingest and read keys can be rotated here. Admin keys are replaced with the create-key CLI,
// so a mistake in the dashboard can't lock everyone out. JSON body: numbers are real numbers.
export const RotateBody = z.strictObject({
  scope: z.enum(["ingest", "read"]),
  graceHours: z.number().int().min(0).max(MAX_GRACE_HOURS).default(24),
});

export const KeyParams = z.strictObject({ id: z.uuid() });

// Revoke takes no body; an empty JSON object is also accepted.
export const EmptyBody = z.strictObject({}).optional();

export const AuditQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  // The id of the last row seen (the previous page's nextCursor).
  cursor: z.string().regex(/^\d{1,15}$/, "invalid cursor").transform(Number).optional(),
});
