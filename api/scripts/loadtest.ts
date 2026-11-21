/*
  Load test for a running Oculus API. No extra dependencies: Node's built-in fetch.

    ingest  `concurrency` workers post 100-event batches to POST /v1/events for `seconds`, then
            it prints throughput, latency percentiles of accepted batches, and every status seen.
    reads   times each dashboard endpoint one request at a time (so they don't compete with
            each other) and prints latency percentiles. Run it after `ingest` to time the queries
            at that data volume.

  Keys come from the environment, so they stay out of shell history and the process list:
    OCULUS_INGEST_KEY=... npm run loadtest -w api -- ingest --url https://oculus.example.com
    OCULUS_READ_KEY=...   npm run loadtest -w api -- reads  --url https://oculus.example.com

  Per-key rate limits still apply (ingest: 20 burst, 60/min), so against normal settings this
  mostly measures the limiter. To measure the server, start the API with higher INGEST_* and
  READ_* limits (see config.ts). Use a key for a throwaway game: every accepted event is stored.
*/
import { parseArgs } from "node:util";
import { MAX_BATCH, type ViolationEvent } from "../src/schemas/events.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: "string", default: "http://127.0.0.1:3000" },
    seconds: { type: "string", default: "20" },
    concurrency: { type: "string", default: "10" },
    requests: { type: "string", default: "30" },
  },
});
const base = values.url.replace(/\/$/, "");

function envKey(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set`);
    process.exit(1);
  }
  return value;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
}

function latencySummary(ms: number[]): string {
  const sorted = [...ms].sort((a, b) => a - b);
  const f = (p: number) => `${percentile(sorted, p).toFixed(1)} ms`;
  return `p50 ${f(50)}  p95 ${f(95)}  p99 ${f(99)}  max ${f(100)}`;
}

function countsText(counts: Map<string, number>): string {
  return [...counts].map(([status, n]) => `${status}×${n}`).join("  ");
}

// Varied enough to look like real traffic to the indexes: 500 players, 20 servers, 6 remotes,
// timestamps spread over the last hour.
const REMOTES = ["Attack", "BuyItem", "UseAbility", "Shop/Buy", "Chat", "Teleport"];
const RULES = ["RateLimit", "SchemaMismatch", "RangeCheck"];
let seq = 0;
function batch(): { events: ViolationEvent[] } {
  const now = Date.now();
  return {
    events: Array.from({ length: MAX_BATCH }, () => {
      seq++;
      const player = 1 + ((seq * 7919) % 500);
      return {
        timestamp: now - Math.floor(Math.random() * 3600_000),
        serverId: `load-${seq % 20}`,
        playerId: player,
        playerName: `LoadPlayer${player}`,
        remote: REMOTES[seq % REMOTES.length]!,
        rule: RULES[seq % RULES.length]!,
        detail: "load test",
        mode: seq % 4 === 0 ? "enforce" : "shadow",
      };
    }),
  };
}

const statusOf = (err: unknown) =>
  ((err as { cause?: { code?: string } }).cause?.code ?? "network error").toString();

async function ingest() {
  const authorization = `Bearer ${envKey("OCULUS_INGEST_KEY")}`;
  const seconds = Number(values.seconds);
  const concurrency = Number(values.concurrency);
  const accepted: number[] = [];
  const statuses = new Map<string, number>();

  console.log(`POST ${base}/v1/events: ${concurrency} workers, ${seconds}s, ${MAX_BATCH} events per batch`);
  const started = performance.now();
  const deadline = started + seconds * 1000;
  const worker = async () => {
    while (performance.now() < deadline) {
      const body = JSON.stringify(batch());
      const t0 = performance.now();
      let status: string;
      try {
        const res = await fetch(`${base}/v1/events`, {
          method: "POST",
          headers: { authorization, "content-type": "application/json" },
          body,
        });
        await res.arrayBuffer();
        status = String(res.status);
      } catch (err) {
        status = statusOf(err);
      }
      // Only accepted batches count toward latency: refusals (429s) return early and would hide it.
      if (status === "202") accepted.push(performance.now() - t0);
      statuses.set(status, (statuses.get(status) ?? 0) + 1);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsed = (performance.now() - started) / 1000;

  console.log(`statuses     ${countsText(statuses)}`);
  console.log(`throughput   ${(accepted.length / elapsed).toFixed(1)} batches/s = ${((accepted.length * MAX_BATCH) / elapsed).toFixed(0)} events/s accepted`);
  if (accepted.length) console.log(`latency      ${latencySummary(accepted)}  (accepted batches)`);
}

async function reads() {
  const headers = { authorization: `Bearer ${envKey("OCULUS_READ_KEY")}` };
  const n = Number(values.requests);
  const get = async (path: string) => {
    const t0 = performance.now();
    try {
      const res = await fetch(`${base}${path}`, { headers });
      const body: unknown = await res.json().catch(() => null);
      return { status: String(res.status), ms: performance.now() - t0, body };
    } catch (err) {
      return { status: statusOf(err), ms: performance.now() - t0, body: null };
    }
  };

  // Open the busiest player and remote, so the detail endpoints are timed on data that exists.
  type Items<T> = { items?: T[] } | null;
  const topPlayer = ((await get("/v1/players?limit=1")).body as Items<{ playerId: number }>)?.items?.[0];
  const topRemote = ((await get("/v1/remotes")).body as Items<{ remote: string }>)?.items?.[0];
  const paths = [
    "/v1/stats/summary",
    "/v1/stats/hourly",
    "/v1/stats/top-remotes",
    "/v1/violations?limit=50",
    "/v1/players?window=24h",
    "/v1/players?window=7d&sort=enforced",
    "/v1/remotes?window=24h",
    "/v1/remotes?window=7d",
  ];
  if (topPlayer) paths.push(`/v1/players/${topPlayer.playerId}?window=7d`);
  if (topRemote) paths.push(`/v1/remotes/${encodeURIComponent(topRemote.remote)}?window=7d`);

  console.log(`GET ${base}: ${n} sequential requests per endpoint, after one warm-up`);
  for (const path of paths) {
    await get(path);
    const ok: number[] = [];
    const other = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const r = await get(path);
      if (r.status === "200") ok.push(r.ms);
      else other.set(r.status, (other.get(r.status) ?? 0) + 1);
    }
    const refused = other.size ? `  (not 200: ${countsText(other)})` : "";
    console.log(`${path.padEnd(44)} ${ok.length ? latencySummary(ok) : "no successful requests"}${refused}`);
  }
}

const mode = positionals[0];
if (mode === "ingest") await ingest();
else if (mode === "reads") await reads();
else {
  console.error("usage: loadtest ingest|reads [--url URL] [--seconds 20] [--concurrency 10] [--requests 30]");
  process.exit(1);
}
