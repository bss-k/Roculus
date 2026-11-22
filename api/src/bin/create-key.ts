/*
  Mints an API key for a game and prints it ONCE. Only its sha256 hash is stored.
  Re-running for the same game and scope rotates the key:
    --grace-hours 0 (default)  the old key stops working immediately
    --grace-hours N (1-168)    the old key keeps working for N more hours, so game servers and the
                               dashboard can switch over without dropping requests
  Admin keys (for the dashboard's key management) can only be made here, never with a grace period.

  npm run create-key -w api -- --game "My Game" --universe 123456 --scope ingest [--grace-hours 24]
*/
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { displayPrefix, generateKey, hashKey } from "../lib/keys.js";
import { MAX_GRACE_HOURS, rotateKey, upsertGame } from "../repo/keys.js";

const Args = z
  .object({
    game: z.string().min(1),
    universe: z.coerce.number().int().positive(),
    scope: z.enum(["ingest", "read", "admin"]),
    "grace-hours": z.coerce.number().int().min(0).max(MAX_GRACE_HOURS).default(0),
  })
  .refine((a) => a.scope !== "admin" || a["grace-hours"] === 0, "admin keys can't have a grace period");

const { values } = parseArgs({
  options: {
    game: { type: "string" },
    universe: { type: "string" },
    scope: { type: "string" },
    "grace-hours": { type: "string" },
  },
});
const parsed = Args.safeParse(values);
if (!parsed.success) {
  console.error(parsed.error.issues.map((i) => i.message).join("\n"));
  console.error(
    'usage: create-key --game "<name>" --universe <universeId> --scope ingest|read|admin [--grace-hours 0-168]',
  );
  process.exit(1);
}
const args = parsed.data;

const db = createPool(loadConfig().DATABASE_URL);
try {
  const gameId = await upsertGame(db, args.game, args.universe);
  const raw = generateKey();
  const result = await rotateKey(db, {
    gameId,
    scope: args.scope,
    keyHash: hashKey(raw),
    keyPrefix: displayPrefix(raw),
    graceHours: args["grace-hours"],
    audit: { actorKeyId: null, via: "cli" },
  });
  if (result.status === "grace_in_progress") {
    console.error(
      `refused: ${result.inGrace.prefix}… is still in its grace period (until ${result.inGrace.expiresAt}).\n` +
        "Wait for it to expire, revoke it from the dashboard, or rotate with --grace-hours 0 to end both old keys now.",
    );
    process.exitCode = 1;
  } else {
    console.log(`${args.scope} key for "${args.game}" (shown once, store it now):\n\n  ${raw}\n`);
    for (const old of result.previous) {
      const ended = Date.parse(old.expiresAt) <= Date.now();
      console.log(`previous key ${old.prefix}… ${ended ? "stopped working now" : `keeps working until ${old.expiresAt}`}`);
    }
  }
} finally {
  await db.end();
}
