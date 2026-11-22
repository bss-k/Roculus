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

// Milestone 3: Ingestion & keys. Types mirror api/src/repo/{ingestion,keys}.ts.

export type RejectReason = "bad_key" | "invalid_schema" | "rate_limited" | "too_large";
export type ReasonCounts = Record<RejectReason, number>;

export interface IngestionBucket {
  start: string;
  accepted: number;
  rejected: number;
  byReason: ReasonCounts;
}

export interface IngestionOverview {
  buckets: IngestionBucket[];
  totals: { accepted: number; rejected: number; byReason: ReasonCounts };
  unattributedBadKey: { count: number; scope: "all_games" };
}

export interface ServerRow {
  serverId: string;
  events: number;
  firstReceived: string;
  lastReceived: string;
  silent: boolean;
}

export interface ServerList {
  items: ServerRow[];
  truncated: boolean;
  silentAfterMinutes: number;
}

export const ingestionApi = {
  overview: (window: WindowId, signal?: AbortSignal) => getJson<IngestionOverview>(`/ingestion?${qs({ window })}`, signal),
  servers: (window: WindowId, signal?: AbortSignal) => getJson<ServerList>(`/ingestion/servers?${qs({ window })}`, signal),
};

export type KeyScope = "ingest" | "read" | "admin";
export type KeyStatus = "active" | "expiring" | "expired" | "revoked";

export interface KeyRow {
  id: string;
  prefix: string;
  scope: KeyScope;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  status: KeyStatus;
}

export interface RotatedKey {
  key: string; // the raw key: shown once, never fetched again
  id: string;
  prefix: string;
  scope: "ingest" | "read";
  createdAt: string;
  graceHours: number;
  previous: { id: string; prefix: string; expiresAt: string }[];
}

export interface AuditRow {
  id: number;
  at: string;
  action: "rotate" | "revoke";
  actor: { id: string; prefix: string } | null;
  target: { id: string; prefix: string; scope: KeyScope } | null;
  detail: { scope?: string; graceHours?: number; via?: "api" | "cli"; previous?: { prefix: string }[] } | null;
}

// An admin request the API refused; `status` lets the screen tell "wrong key" from "offline".
export class AdminError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

/*
  Admin calls go to /dash/admin/*, which the Vite proxy (dev) and nginx (deploy) forward to the
  API's /v1/admin/* without adding any key of their own. The key travels in X-Oculus-Admin-Key,
  not Authorization, because on the deployed site Authorization already carries the browser's
  dashboard login (Caddy's basic auth); the proxy moves it into "Authorization: Bearer" for the API.
  The key itself only ever lives in the calling component's state.
*/
async function adminJson<T>(adminKey: string, method: "GET" | "POST", path: string, body?: object): Promise<T> {
  const headers: Record<string, string> = { "x-oculus-admin-key": adminKey };
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(`/dash/admin${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new AdminError(res.status, json.error, json.message ?? `request failed (${res.status})`, json.hint);
  return json as T;
}

export const adminApi = {
  keys: (adminKey: string) => adminJson<{ items: KeyRow[] }>(adminKey, "GET", "/keys").then((r) => r.items),
  rotate: (adminKey: string, scope: "ingest" | "read", graceHours: number) =>
    adminJson<RotatedKey>(adminKey, "POST", "/keys/rotate", { scope, graceHours }),
  revoke: (adminKey: string, id: string) =>
    adminJson<{ key: KeyRow }>(adminKey, "POST", `/keys/${encodeURIComponent(id)}/revoke`),
  audit: (adminKey: string, cursor?: string) =>
    adminJson<{ items: AuditRow[]; nextCursor: string | null }>(adminKey, "GET", `/audit?${qs({ limit: 20, cursor })}`),
};
