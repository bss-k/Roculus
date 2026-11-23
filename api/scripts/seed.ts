/*
  Local demo data. Creates two demo games ("Demo Game" and "Demo Obby", so the dashboard's game
  picker has something to switch between), mints fresh ingest + read + admin keys for each, and
  sends ~24h of realistic violations through the real POST /v1/events path (so validation is
  exercised). The read keys are written to web/.env.local (OCULUS_READ_KEYS) for the Vite proxy.

  Shape of the fake traffic:
    - steady background noise: laggy players tripping rate limits, old clients failing schemas
    - 4 "exploiters" who come back several times a day, hammering Attack in short, dense
      bursts (so Attack is the clear top remote); two of them also hit BuyItem
    - ~25% of remotes in enforce mode, the rest in shadow (as during a real rollout), so
      Attack's abuse is blocked while BuyItem's is only logged
*/
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db/pool.js";
import { displayPrefix, generateKey, hashKey } from "../src/lib/keys.js";
import { rotateKey, upsertGame } from "../src/repo/keys.js";
import { MAX_BATCH, type ViolationEvent } from "../src/schemas/events.js";
import { buildServer } from "../src/server.js";

// slug: the game's name in OCULUS_READ_KEYS. scale: share of the traffic below it gets.
const DEMO_GAMES = [
  { slug: "demo", name: "Demo Game", universe: 1, scale: 1 },
  { slug: "obby", name: "Demo Obby", universe: 2, scale: 0.35 },
] as const;
const HOUR = 3600_000;

// Deterministic PRNG (mulberry32) so every seed run looks the same.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(42);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;

const REMOTES = {
  Attack: "enforce",
  UseAbility: "enforce",
  BuyItem: "shadow",
  EquipWeapon: "shadow",
  Interact: "shadow",
  Trade: "shadow",
  Emote: "shadow",
  SetSetting: "shadow",
} as const;
type Remote = keyof typeof REMOTES;
const REMOTE_NAMES = Object.keys(REMOTES) as Remote[];

const DETAILS: Record<string, (remote: Remote) => string> = {
  RateLimit: () => `${8 + Math.floor(rand() * 60)} calls/s exceeds limit of 5/s`,
  GlobalRateLimit: () => `server-wide ${300 + Math.floor(rand() * 900)} calls/s exceeds 250/s`,
  Schema: (remote) =>
    pick([
      "targetId: expected integer, got string",
      "args[2]: expected string (max 32), got table",
      "itemId: expected integer in [1, 1000000], got -1",
      "amount: expected number, got nan",
      `unexpected extra argument #3 on ${remote}`,
    ]),
  Check: () => pick(["target out of range (148 studs > 20)", "ability on cooldown (0.4s left)", "not enough currency"]),
};

const SERVERS = Array.from({ length: 6 }, () => crypto.randomUUID());
const PLAYERS = Array.from({ length: 80 }, (_, i) => ({
  id: 100_000_000 + Math.floor(rand() * 4_000_000_000),
  name: `${pick(["Noob", "Pro", "Shadow", "Pixel", "Turbo", "Blox", "Cyber", "Lucky"])}${pick(["Ninja", "Gamer", "Knight", "Fox", "Wizard"])}${i}`,
}));

// Fixed picks (not random) so it's always the same 4 players; they also appear in the noise.
const EXPLOITERS = [PLAYERS[7]!, PLAYERS[23]!, PLAYERS[41]!, PLAYERS[66]!];

function event(timestamp: number, player: (typeof PLAYERS)[number], remote: Remote, rule: string, serverId: string): ViolationEvent {
  return {
    timestamp: Math.round(timestamp),
    serverId,
    playerId: player.id,
    playerName: player.name,
    remote,
    rule,
    detail: DETAILS[rule]!(remote),
    mode: REMOTES[remote],
  };
}

// A smaller game gets fewer of them.
const exploitersFor = (scale: number) => EXPLOITERS.slice(0, Math.max(1, Math.round(EXPLOITERS.length * scale)));

function generate(now: number, scale: number): ViolationEvent[] {
  const events: ViolationEvent[] = [];
  const start = now - 23.5 * HOUR;

  // Background noise, busier in the evening hours.
  for (let i = 0; i < 1400 * scale; i++) {
    const t = start + rand() * (now - start);
    const hour = new Date(t).getUTCHours();
    if (rand() > (hour >= 0 && hour <= 6 ? 1 : 0.55)) continue; // UTC 0-6 ≈ US evening peak
    const rule = rand() < 0.6 ? "RateLimit" : rand() < 0.85 ? "Schema" : "Check";
    events.push(event(t, pick(PLAYERS), pick(REMOTE_NAMES), rule, pick(SERVERS)));
  }

  // Exploiters: the same few players coming back for several bursts across the day, each burst
  // a few minutes of spam, mostly at Attack. Two of them also probe BuyItem (still in shadow).
  exploitersFor(scale).forEach((exploiter, n) => {
    const secondary: Remote = n < 2 ? "BuyItem" : "UseAbility";
    const bursts = 3 + Math.floor(rand() * 2);
    for (let b = 0; b < bursts; b++) {
      const server = pick(SERVERS);
      const burstStart = start + rand() * (now - start - 10 * 60_000);
      const size = 50 + Math.floor(rand() * 70);
      for (let i = 0; i < size; i++) {
        const rule = rand() < 0.7 ? "RateLimit" : "Schema";
        const remote = rand() < 0.75 ? "Attack" : secondary;
        events.push(event(burstStart + rand() * 6 * 60_000, exploiter, remote, rule, server));
      }
      if (rand() < 0.5) events.push(event(burstStart, exploiter, "Attack", "GlobalRateLimit", server));
    }
  });

  return events.sort((a, b) => a.timestamp - b.timestamp);
}

async function mintKey(db: ReturnType<typeof createPool>, gameId: string, scope: "ingest" | "read" | "admin") {
  const raw = generateKey();
  await rotateKey(db, { gameId, scope, keyHash: hashKey(raw), keyPrefix: displayPrefix(raw) });
  return raw;
}

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
try {
  // Send through the real API (in-process, no network) with rate limits lifted for the seed.
  const app = buildServer({ config: { ...config, INGEST_BURST: 1e6 }, db, logger: false });
  const readKeys: string[] = [];
  const printed: string[] = [];
  for (const demo of DEMO_GAMES) {
    const gameId = await upsertGame(db, demo.name, demo.universe);
    await db.query("DELETE FROM events WHERE game_id = $1", [gameId]);
    const ingestKey = await mintKey(db, gameId, "ingest");
    const readKey = await mintKey(db, gameId, "read");
    const adminKey = await mintKey(db, gameId, "admin");
    readKeys.push(`${demo.slug}=${readKey}`);

    const events = generate(Date.now(), demo.scale);
    for (let i = 0; i < events.length; i += MAX_BATCH) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/events",
        headers: { authorization: `Bearer ${ingestKey}` },
        payload: { events: events.slice(i, i + MAX_BATCH) },
      });
      if (res.statusCode !== 202) throw new Error(`seed batch failed: ${res.statusCode} ${res.body}`);
    }

    const countFor = (match: (e: ViolationEvent) => boolean) => events.filter(match).length;
    printed.push(
      `"${demo.name}" (${demo.slug}): ${events.length} events, Attack ${countFor((e) => e.remote === "Attack")}`,
      `  exploiters: ${exploitersFor(demo.scale).map((p) => `${p.name} (${countFor((e) => e.playerId === p.id)})`).join(", ")}`,
      `  ingest key (for manual curl tests): ${ingestKey}`,
      `  admin key (paste into the Ingestion & keys screen to unlock it): ${adminKey}`,
    );
  }
  await app.close();

  const envPath = fileURLToPath(new URL("../../web/.env.local", import.meta.url));
  await writeFile(
    envPath,
    `# Written by npm run seed. Dev-only read keys (one per game) used by the Vite proxy.\nOCULUS_READ_KEYS=${readKeys.join(",")}\n`,
  );

  for (const line of printed) console.log(line);
  console.log("read keys written to web/.env.local");
} finally {
  await db.end();
}
