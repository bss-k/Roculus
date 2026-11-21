// Typed wrappers for the dashboard endpoints. Types mirror api/src/repo/stats.ts.

export type Mode = "shadow" | "enforce";

export interface Summary {
  total: number;
  enforced: number;
  shadowed: number;
  uniquePlayers: number;
  uniqueServers: number;
  lastEventAt: string | null;
  byRule: { rule: string; count: number }[];
}

export interface HourBucket {
  hour: string;
  shadow: number;
  enforce: number;
}

export interface RemoteCount {
  remote: string;
  count: number;
}

export interface Violation {
  id: number;
  occurredAt: string;
  serverId: string;
  playerId: number;
  playerName: string;
  remote: string;
  rule: string;
  detail: string;
  mode: Mode;
}

export interface ViolationPage {
  items: Violation[];
  nextCursor: string | null;
}

// Milestone 2: Players and Remotes. Types mirror api/src/repo/{players,remotes,buckets}.ts.

export type WindowId = "1h" | "24h" | "7d";

export interface Bucket {
  start: string;
  shadow: number;
  enforce: number;
}

export interface RuleCount {
  rule: string;
  count: number;
}

export type PlayerSort = "total" | "enforced" | "lastSeen";

export interface PlayerRow {
  playerId: number;
  playerName: string;
  total: number;
  enforced: number;
  shadowed: number;
  rules: string[];
  remotes: number;
  firstSeen: string;
  lastSeen: string;
}

export interface PlayerPage {
  items: PlayerRow[];
  nextOffset: number | null;
}

export interface PlayerDetail {
  player: {
    playerId: number;
    playerName: string;
    total: number;
    enforced: number;
    shadowed: number;
    servers: number;
    firstSeen: string | null;
    lastSeen: string | null;
  };
  byRule: RuleCount[];
  byRemote: RemoteCount[];
  buckets: Bucket[];
}

export type RemoteSort = "total" | "enforced" | "uniquePlayers";

export interface RemoteRow {
  remote: string;
  total: number;
  enforced: number;
  shadowed: number;
  uniquePlayers: number;
  byRule: RuleCount[];
  lastSeen: string;
  mode: Mode;
  buckets: Bucket[];
}

export interface RemoteDetail {
  remote: {
    remote: string;
    total: number;
    enforced: number;
    shadowed: number;
    uniquePlayers: number;
    lastSeen: string | null;
    mode: Mode;
  };
  byRule: RuleCount[];
  topPlayers: { playerId: number; playerName: string; total: number; enforced: number }[];
  buckets: Bucket[];
}

const BASE = "/dash/v1";

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(BASE + path, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// Builds a query string, leaving out unset params (the API rejects unknown or empty ones).
function qs(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value));
  return query.toString();
}

export const api = {
  summary: (signal?: AbortSignal) => getJson<Summary>("/stats/summary", signal),
  hourly: (signal?: AbortSignal) => getJson<{ hours: HourBucket[] }>("/stats/hourly", signal).then((r) => r.hours),
  topRemotes: (limit: number, signal?: AbortSignal) =>
    getJson<{ remotes: RemoteCount[] }>(`/stats/top-remotes?limit=${limit}`, signal).then((r) => r.remotes),
  violations: (
    params: { rule?: string; playerId?: number; remote?: string; limit?: number; cursor?: string },
    signal?: AbortSignal,
  ) => getJson<ViolationPage>(`/violations?${qs(params)}`, signal),

  players: (
    params: { window: WindowId; sort: PlayerSort; q?: string; limit?: number; offset?: number },
    signal?: AbortSignal,
  ) => getJson<PlayerPage>(`/players?${qs(params)}`, signal),
  player: (playerId: number, window: WindowId, signal?: AbortSignal) =>
    getJson<PlayerDetail>(`/players/${playerId}?${qs({ window })}`, signal),
  remotes: (params: { window: WindowId; sort: RemoteSort }, signal?: AbortSignal) =>
    getJson<{ items: RemoteRow[] }>(`/remotes?${qs(params)}`, signal).then((r) => r.items),
  // Remote names can contain "/", spaces, anything: always encode them into the path.
  remote: (remote: string, window: WindowId, signal?: AbortSignal) =>
    getJson<RemoteDetail>(`/remotes/${encodeURIComponent(remote)}?${qs({ window })}`, signal),
};
