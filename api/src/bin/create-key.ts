/*
  Mints an API key for a game and prints it ONCE. Only its sha256 hash is stored.
  Re-running for the same game and scope rotates the key (the old one stops working).

  npm run create-key -w api -- --game "My Game" --universe 123456 --scope ingest
*/
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { displayPrefix, generateKey, hashKey } from "../lib/keys.js";
import { rotateKey, upsertGame } from "../repo/keys.js";

const Args = z.object({
  game: z.string().min(1),
  universe: z.coerce.number().int().positive(),
  scope: z.enum(["ingest", "read"]),
});

const { values } = parseArgs({
  options: { game: { type: "string" }, universe: { type: "string" }, scope: { type: "string" } },
});
const parsed = Args.safeParse(values);
if (!parsed.success) {
  console.error('usage: create-key --game "<name>" --universe <universeId> --scope ingest|read');
  process.exit(1);
}
const args = parsed.data;

const db = createPool(loadConfig().DATABASE_URL);
try {
  const gameId = await upsertGame(db, args.game, args.universe);
  const raw = generateKey();
  const { revoked } = await rotateKey(db, {
    gameId,
    scope: args.scope,
    keyHash: hashKey(raw),
    keyPrefix: displayPrefix(raw),
  });
  console.log(`${args.scope} key for "${args.game}" (shown once, store it now):\n\n  ${raw}\n`);
  if (revoked) console.log(`revoked ${revoked} previous ${args.scope} key(s)`);
} finally {
  await db.end();
}
