/*
  Remotes screen: which RemoteEvents/Functions are being attacked over a 1h / 24h / 7d window,
  and whether Remote-Guard is blocking them (enforce) or only watching (shadow).
  Refreshes every 15s. One drawer at a time: a remote's, or a player's opened from it.
*/
import { useState } from "react";
import { api, type RemoteSort, type WindowId } from "../api/client";
import { Empty, Panel } from "../components/Panel";
import { PlayerDrawer } from "../components/PlayerDrawer";
import { RemoteDrawer } from "../components/RemoteDrawer";
import { RemotesTable } from "../components/RemotesTable";
import { WindowSelect } from "../components/WindowSelect";
import { usePolling } from "../hooks/usePolling";
import { formatNumber } from "../lib/format";
import { windowLong } from "../lib/windows";

const POLL_MS = 15_000;

const SORTS: { id: RemoteSort; label: string }[] = [
  { id: "total", label: "Most violations" },
  { id: "enforced", label: "Most enforced" },
  { id: "uniquePlayers", label: "Most players" },
];

type DrawerState =
  | { kind: "remote"; remote: string; window: WindowId }
  | { kind: "player"; playerId: number; playerName: string; window: WindowId }
  | null;

export function Remotes() {
  const [windowId, setWindowId] = useState<WindowId>("24h");
  const [sort, setSort] = useState<RemoteSort>("total");
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const list = usePolling((signal) => api.remotes({ window: windowId, sort }, signal), POLL_MS, `${windowId}|${sort}`);
  const rows = list.data;

  const filters = (
    <div className="filters">
      <WindowSelect value={windowId} onChange={setWindowId} />
      <label>
        Sort{" "}
        <select value={sort} onChange={(e) => setSort(e.target.value as RemoteSort)}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  let body;
  if (!rows) {
    body = list.error ? null : <div className="skeleton" />;
  } else if (rows.length === 0) {
    body = <Empty>No attacked remotes in the {windowLong(windowId)}.</Empty>;
  } else {
    body = (
      <RemotesTable
        rows={rows}
        updating={list.loading}
        onOpen={(r) => setDrawer({ kind: "remote", remote: r.remote, window: windowId })}
      />
    );
  }

  return (
    <>
      <Panel title="Remotes" action={filters}>
        {list.error && (
          <div className="banner">
            {rows ? "Couldn't refresh: " : "Can't reach the API: "}
            {list.error}
          </div>
        )}
        {body}
        {rows && rows.length > 0 && (
          <div className="table-footer">
            <span className="muted">{formatNumber(rows.length)} remotes · refreshes every 15s</span>
          </div>
        )}
      </Panel>

      {drawer?.kind === "remote" && (
        <RemoteDrawer
          remote={drawer.remote}
          initialWindow={drawer.window}
          onClose={() => setDrawer(null)}
          onOpenPlayer={(player, window) => setDrawer({ kind: "player", ...player, window })}
        />
      )}
      {drawer?.kind === "player" && (
        <PlayerDrawer
          playerId={drawer.playerId}
          playerName={drawer.playerName}
          initialWindow={drawer.window}
          onClose={() => setDrawer(null)}
        />
      )}
    </>
  );
}
