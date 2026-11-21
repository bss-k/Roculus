import { z } from "zod";

export const MAX_BATCH = 100;
export const MAX_AGE_MS = 24 * 60 * 60 * 1000; // older events are refused
export const MAX_SKEW_MS = 5 * 60 * 1000; // allowed clock drift into the future

// Unix time in milliseconds, inside [now - 24h, now + 5min].
const timestamp = z
  .number()
  .int()
  .refine((ms) => {
    const now = Date.now();
    return ms >= now - MAX_AGE_MS && ms <= now + MAX_SKEW_MS;
  }, "timestamp must be Unix ms within the last 24h");

// z.strictObject rejects any field not listed here.
export const ViolationEvent = z.strictObject({
  timestamp,
  serverId: z.string().min(1).max(64),
  playerId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  playerName: z.string().min(1).max(32),
  remote: z.string().min(1).max(100),
  rule: z.string().min(1).max(64),
  detail: z.string().max(256),
  mode: z.enum(["shadow", "enforce"]),
});

export const EventBatch = z.strictObject({
  events: z.array(ViolationEvent).min(1).max(MAX_BATCH),
});

export type ViolationEvent = z.infer<typeof ViolationEvent>;
