/*
  Key management, unlocked with an admin key.

  The admin key lives only in this component's state: never in localStorage, sessionStorage,
  the URL or a cookie. It's gone when you press Lock, leave this screen or reload the page.
  Admin keys themselves can't be rotated or revoked here (only with the create-key CLI), so
  nothing done on this screen can lock you out of it.

  An admin key manages exactly one game: the one it was made for. Unlocking checks that this is
  the game the dashboard is showing (the game picker at the top), so you never manage one
  game's keys while looking at another's numbers. Switching games locks this screen again.
*/
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AdminError, adminApi, type AuditRow, type KeyRow, type KeyStatus, type RotatedKey } from "../api/client";
import { gameLabel, useCurrentGame, type Game } from "../hooks/useGames";
import { formatDateTime, timeAgo } from "../lib/format";
import { Modal } from "./Modal";
import { Empty, Panel } from "./Panel";

const GRACE_OPTIONS = [
  { hours: 0, label: "None (old key stops now)" },
  { hours: 1, label: "1 hour" },
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
];

const SCOPE_LABEL = { ingest: "Ingest", read: "Read", admin: "Admin" } as const;

function graceText(hours: number) {
  return hours === 0 ? "stops working immediately" : `keeps working for ${GRACE_OPTIONS.find((g) => g.hours === hours)?.label ?? `${hours} hours`}, then stops`;
}

// What to tell the person when the API refuses their admin key.
function keyProblem(err: unknown): string {
  if (err instanceof AdminError) {
    if (err.status === 401 && err.hint === "expired") return "That admin key has expired. Create a new one with the create-key CLI.";
    if (err.status === 401) return "That key wasn't recognized (mistyped, revoked, or replaced).";
    if (err.status === 403) return "That's not an admin key. Read and ingest keys can't manage keys.";
    if (err.status === 429) return "Too many attempts. Wait a minute and try again.";
  }
  return `Couldn't reach the API: ${(err as Error).message}`;
}

export function KeysPanel() {
  const game = useCurrentGame();
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [lockReason, setLockReason] = useState<string | null>(null);

  const lock = useCallback((reason: string | null = null) => {
    setAdminKey(null);
    setLockReason(reason);
  }, []);

  if (!game) return null;
  if (!adminKey) {
    return (
      <UnlockForm
        game={game}
        notice={lockReason}
        onUnlocked={(key) => {
          setLockReason(null);
          setAdminKey(key);
        }}
      />
    );
  }
  return <KeyManager game={game} adminKey={adminKey} onLock={lock} />;
}

function UnlockForm({ game, notice, onUnlocked }: { game: Game; notice: string | null; onUnlocked: (key: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const key = value.trim();
    if (!key) return;
    setBusy(true);
    setError(null);
    try {
      // Proves the key is a working admin key, and says which game it manages.
      const keyGame = await adminApi.game(key);
      if (!game.info) {
        setError(`Can't check which game that admin key is for: the read key for “${game.slug}” isn't working.`);
        return;
      }
      if (keyGame.universeId !== game.info.universeId) {
        setError(
          `That admin key is for “${keyGame.name}” (universe ${keyGame.universeId}), but the dashboard is showing ` +
            `“${game.info.name}”. Use ${game.info.name}'s admin key, or switch games in the menu at the top.`,
        );
        return;
      }
      setValue("");
      onUnlocked(key);
    } catch (err) {
      setError(keyProblem(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="API keys" action={<span className="lock-state">🔒 Locked</span>}>
      {notice && <div className="banner">{notice}</div>}
      <form className="unlock" onSubmit={submit}>
        <p className="muted">
          Managing the keys of <strong>{gameLabel(game)}</strong> needs its <strong>admin key</strong> (made with{" "}
          <code className="mono">create-key --scope admin</code>). It stays in this page&apos;s memory only, until you
          lock, leave this screen, switch games or reload.
        </p>
        <div className="unlock-row">
          <label className="sr-only" htmlFor="admin-key">
            Admin key
          </label>
          <input
            id="admin-key"
            className="search unlock-input mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="ocl_…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "admin-key-error" : undefined}
          />
          <button type="submit" className="btn" disabled={busy || !value.trim()}>
            {busy ? "Checking…" : "Unlock"}
          </button>
        </div>
        {error && (
          <p id="admin-key-error" className="error-text" role="alert">
            {error}
          </p>
        )}
      </form>
    </Panel>
  );
}

type Pending =
  | { kind: "rotate"; scope: "ingest" | "read"; graceHours: number }
  | { kind: "revoke"; key: KeyRow }
  | null;

function KeyManager({ game, adminKey, onLock }: { game: Game; adminKey: string; onLock: (reason?: string | null) => void }) {
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [audit, setAudit] = useState<{ items: AuditRow[]; nextCursor: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<"ingest" | "read">("ingest");
  const [graceHours, setGraceHours] = useState(24);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<RotatedKey | null>(null);
  // Shown after rotating the read key, until you lock: the server's copy must be updated.
  const [readRotation, setReadRotation] = useState<RotatedKey | null>(null);
  // Responses that arrive after this unmounts (Lock, leaving the screen) are dropped. Set on
  // mount as well as cleared on unmount: React's StrictMode mounts, unmounts and mounts again.
  const live = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // Any 401 means this admin key stopped working (expired, or replaced with the CLI): lock.
  const handle = useCallback(
    (err: unknown) => {
      if (err instanceof AdminError && err.status === 401) onLock(keyProblem(err));
      else if (err instanceof AdminError && err.code === "grace_in_progress")
        setError(
          "Not rotated: an older key of this scope is still in its grace period, and only two can work at once. " +
            "Revoke the older one, wait for it to expire, or rotate with grace period “None”.",
        );
      else setError(err instanceof AdminError ? err.message : keyProblem(err));
    },
    [onLock],
  );

  const refresh = useCallback(async () => {
    try {
      const [k, a] = await Promise.all([adminApi.keys(adminKey), adminApi.audit(adminKey)]);
      if (!live.current) return;
      setKeys(k);
      setAudit(a);
      setError(null);
    } catch (err) {
      if (live.current) handle(err);
    }
  }, [adminKey, handle]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === "rotate") {
        const rotated = await adminApi.rotate(adminKey, pending.scope, pending.graceHours);
        setNewKey(rotated);
        if (rotated.scope === "read") setReadRotation(rotated);
      } else {
        await adminApi.revoke(adminKey, pending.key.id);
      }
      setPending(null);
      await refresh();
    } catch (err) {
      setPending(null);
      handle(err);
    } finally {
      setBusy(false);
    }
  }

  async function loadMoreAudit() {
    if (!audit?.nextCursor) return;
    try {
      const more = await adminApi.audit(adminKey, audit.nextCursor);
      setAudit({ items: [...audit.items, ...more.items], nextCursor: more.nextCursor });
    } catch (err) {
      handle(err);
    }
  }

  const header = (
    <div className="filters">
      <span className="lock-state lock-open">🔓 Unlocked: {gameLabel(game)}</span>
      <button type="button" className="btn-ghost btn-small" onClick={() => refresh()}>
        Refresh
      </button>
      <button type="button" className="btn-ghost btn-small" onClick={() => onLock(null)}>
        Lock
      </button>
    </div>
  );

  return (
    <>
      <Panel title={`API keys · ${gameLabel(game)}`} action={header}>
        {error && <div className="banner">{error}</div>}
        {readRotation && <ReadKeyNote rotated={readRotation} slug={game.slug} />}

        <div className="rotate-bar">
          <label>
            Key{" "}
            <select value={scope} onChange={(e) => setScope(e.target.value as "ingest" | "read")}>
              <option value="ingest">Ingest (game servers)</option>
              <option value="read">Read (this dashboard)</option>
            </select>
          </label>
          <label>
            Grace period{" "}
            <select value={graceHours} onChange={(e) => setGraceHours(Number(e.target.value))}>
              {GRACE_OPTIONS.map((g) => (
                <option key={g.hours} value={g.hours}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn" onClick={() => setPending({ kind: "rotate", scope, graceHours })}>
            Rotate…
          </button>
        </div>

        {keys ? <KeysTable keys={keys} onRevoke={(key) => setPending({ kind: "revoke", key })} /> : <div className="skeleton skeleton-short" />}
      </Panel>

      <Panel title="Audit log">
        {!audit ? (
          <div className="skeleton skeleton-short" />
        ) : audit.items.length === 0 ? (
          <Empty>No key changes yet.</Empty>
        ) : (
          <>
            <AuditList items={audit.items} />
            {audit.nextCursor && (
              <div className="table-footer">
                <span />
                <button type="button" className="btn-ghost" onClick={loadMoreAudit}>
                  Load more
                </button>
              </div>
            )}
          </>
        )}
      </Panel>

      {pending?.kind === "rotate" && (
        <Modal
          title={`Rotate the ${pending.scope} key?`}
          onClose={() => setPending(null)}
          tone={pending.graceHours === 0 ? "danger" : "default"}
          actions={
            <>
              <button type="button" className="btn-ghost" onClick={() => setPending(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className={pending.graceHours === 0 ? "btn btn-danger" : "btn"} onClick={confirm} disabled={busy}>
                {busy ? "Rotating…" : "Rotate"}
              </button>
            </>
          }
        >
          <p>
            A new {pending.scope} key is created and shown once. The current one {graceText(pending.graceHours)}.
          </p>
          {pending.graceHours === 0 && (
            <p className="error-text">
              Anything still using the current key starts getting 401s right away
              {pending.scope === "read" ? ", including this dashboard until the server is updated" : ""}.
            </p>
          )}
        </Modal>
      )}

      {pending?.kind === "revoke" && (
        <Modal
          title={`Revoke ${pending.key.prefix}…?`}
          onClose={() => setPending(null)}
          tone="danger"
          actions={
            <>
              <button type="button" className="btn-ghost" onClick={() => setPending(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={confirm} disabled={busy}>
                {busy ? "Revoking…" : "Revoke now"}
              </button>
            </>
          }
        >
          <p>
            This {pending.key.scope} key stops working immediately and can&apos;t be restored.
            {pending.key.scope === "read" && " If it's the key this dashboard runs on, the dashboard stops loading data."}
            {pending.key.scope === "ingest" && " Game servers still using it get 401s and drop their events."}
          </p>
        </Modal>
      )}

      {newKey && <NewKeyModal rotated={newKey} slug={game.slug} onDone={() => setNewKey(null)} />}
    </>
  );
}

const STATUS_HINT: Record<KeyStatus, string> = {
  active: "works, no expiry",
  expiring: "works until its grace period ends",
  expired: "grace period over: refused",
  revoked: "refused",
};

function KeysTable({ keys, onRevoke }: { keys: KeyRow[]; onRevoke: (key: KeyRow) => void }) {
  if (keys.length === 0) return <Empty>No keys yet.</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Scope</th>
            <th>Status</th>
            <th>Created</th>
            <th>Last used</th>
            <th>Ends</th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const ends = k.revokedAt ?? k.expiresAt;
            return (
              <tr key={k.id} className={k.status === "expired" || k.status === "revoked" ? "row-dim" : undefined}>
                <td className="mono">{k.prefix}…</td>
                <td>{SCOPE_LABEL[k.scope]}</td>
                <td>
                  <span className={`badge badge-key-${k.status}`} title={STATUS_HINT[k.status]}>
                    {k.status}
                  </span>
                </td>
                <td className="nowrap" title={formatDateTime(k.createdAt)}>
                  {timeAgo(k.createdAt)}
                </td>
                <td className="nowrap" title={k.lastUsedAt ? formatDateTime(k.lastUsedAt) : undefined}>
                  {k.lastUsedAt ? timeAgo(k.lastUsedAt) : <span className="muted">never</span>}
                </td>
                <td className="nowrap">{ends ? formatDateTime(ends) : <span className="muted">—</span>}</td>
                <td className="num">
                  {k.scope === "admin" ? (
                    <span className="muted" title="Admin keys are replaced with the create-key CLI">
                      CLI only
                    </span>
                  ) : k.status !== "revoked" ? (
                    <button type="button" className="btn-ghost btn-small btn-ghost-danger" onClick={() => onRevoke(k)}>
                      Revoke…
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function describeAudit(row: AuditRow): string {
  const target = row.target ? `${row.target.scope} key ${row.target.prefix}…` : "a deleted key";
  if (row.action === "revoke") return `Revoked ${target}`;
  const grace = row.detail?.graceHours;
  const replaced = row.detail?.previous?.length ?? 0;
  if (replaced === 0) return `Created ${target} (no previous key)`;
  return `Created ${target}, ${grace ? `old key kept for ${grace}h` : "old key ended immediately"}`;
}

function AuditList({ items }: { items: AuditRow[] }) {
  return (
    <ul className="feed audit">
      {items.map((row) => (
        <li key={row.id}>
          <span className={`badge badge-audit-${row.action}`}>{row.action}</span>
          <div className="feed-body">
            <div>{describeAudit(row)}</div>
            <div className="muted feed-detail">
              by {row.actor ? <span className="mono">{row.actor.prefix}…</span> : row.detail?.via === "cli" ? "the create-key CLI" : "a deleted key"}
            </div>
          </div>
          <time className="muted" dateTime={row.at} title={formatDateTime(row.at)}>
            {timeAgo(row.at)}
          </time>
        </li>
      ))}
    </ul>
  );
}

// Where the new read key goes on the server: this game's entry in OCULUS_READ_KEYS.
function ReadKeySetting({ slug }: { slug: string }) {
  return (
    <>
      <code className="mono">{slug}=</code> in <code className="mono">OCULUS_READ_KEYS</code>
      {slug === "main" && (
        <>
          {" "}
          (or <code className="mono">OCULUS_READ_KEY</code>, if your <code className="mono">.env</code> uses that)
        </>
      )}
    </>
  );
}

function ReadKeyNote({ rotated, slug }: { rotated: RotatedKey; slug: string }) {
  const until = rotated.previous[0]?.expiresAt;
  const ended = !until || Date.parse(until) <= Date.now();
  return (
    <div className="banner banner-amber" role="status">
      You rotated the read key. Put the new key after <ReadKeySetting slug={slug} /> on the server (
      <code className="mono">.env</code>, then <code className="mono">docker compose --profile deploy up -d web</code>)
      {ended ? ". The old key has already stopped, so the dashboard can't load data until then." : ` before ${formatDateTime(until)}, when the old key stops.`}
    </div>
  );
}

function NewKeyModal({ rotated, slug, onDone }: { rotated: RotatedKey; slug: string; onDone: () => void }) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const field = useRef<HTMLInputElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(rotated.key);
      setCopied("yes");
    } catch {
      // Clipboard access can be refused; select the text so Ctrl/Cmd+C works instead.
      field.current?.select();
      setCopied("failed");
    }
  }

  const old = rotated.previous[0];
  return (
    <Modal
      title={`New ${rotated.scope} key`}
      onClose={onDone}
      dismissible={false}
      actions={
        <button type="button" className="btn" onClick={onDone}>
          I&apos;ve stored it
        </button>
      }
    >
      <p className="error-text">
        <strong>Copy it now: this is the only time it&apos;s shown.</strong> Oculus keeps only a hash of it, so it
        can&apos;t be shown again. If it&apos;s lost, rotate again.
      </p>
      <div className="key-reveal">
        <input
          ref={field}
          className="search mono key-field"
          readOnly
          value={rotated.key}
          aria-label="New key"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" className="btn-ghost" onClick={copy}>
          {copied === "yes" ? "Copied" : "Copy"}
        </button>
      </div>
      {copied === "failed" && <p className="muted">Couldn&apos;t use the clipboard; the key is selected, press Ctrl/Cmd+C.</p>}
      {old && (
        <p className="muted">
          Previous key {old.prefix}…{" "}
          {Date.parse(old.expiresAt) <= Date.now() ? "has stopped working." : `keeps working until ${formatDateTime(old.expiresAt)}.`}
        </p>
      )}
      {rotated.scope === "read" ? (
        <p>
          Next: put this key after <ReadKeySetting slug={slug} /> on the server before the old one stops.
        </p>
      ) : (
        <p>
          Next: update the <code className="mono">OculusApiKey</code> secret in Creator Hub. Running servers pick it up when they
          restart.
        </p>
      )}
    </Modal>
  );
}
