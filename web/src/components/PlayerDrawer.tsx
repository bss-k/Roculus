/*
  Drawer with one player's details. Fetches once per (player, window): open drawers don't
  refresh on their own. Also opened from the Remotes screen (top players).
*/
import { useState } from "react";
import { api, type WindowId } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { formatDay, formatTime, timeAgo } from "../lib/format";
import { chartLabels, windowLong } from "../lib/windows";
import { BucketChart } from "./BucketChart";
import { CountList } from "./CountList";
import { Drawer } from "./Drawer";
import { KpiCard } from "./KpiCard";
import { Panel } from "./Panel";
import { ViolationTimeline } from "./ViolationTimeline";
import { WindowSelect } from "./WindowSelect";

interface PlayerDrawerProps {
  playerId: number;
  playerName?: string; // shown until the details arrive
  initialWindow: WindowId;
  onClose: () => void;
}

export function PlayerDrawer({ playerId, playerName, initialWindow, onClose }: PlayerDrawerProps) {
  const [windowId, setWindowId] = useState<WindowId>(initialWindow);
  const detail = usePolling((signal) => api.player(playerId, windowId, signal), 0, `${playerId}|${windowId}`);
  const d = detail.data;
  const p = d?.player;
  const updating = detail.loading && d !== undefined;

  return (
    <Drawer
      title={p?.playerName ?? playerName ?? `Player ${playerId}`}
      subtitle={
        <>
          Player ID <span className="mono">{playerId}</span>
          {p?.lastSeen && <> · last seen {timeAgo(p.lastSeen)}</>}
        </>
      }
      onClose={onClose}
    >
      <div className="drawer-toolbar">
        <WindowSelect value={windowId} onChange={setWindowId} />
        {updating && <span className="muted">Updating…</span>}
      </div>
      {detail.error && <div className="banner">{detail.error}</div>}

      <div className={updating ? "kpis is-updating" : "kpis"}>
        <KpiCard
          label={`Violations (${windowId})`}
          value={p?.total}
          accent="blue"
          hint={p?.firstSeen ? `first ${formatDay(p.firstSeen)} ${formatTime(p.firstSeen)}` : undefined}
        />
        <KpiCard label="Enforced" value={p?.enforced} accent="red" hint="calls dropped" />
        <KpiCard label="Shadow" value={p?.shadowed} accent="amber" hint="logged, still ran" />
        <KpiCard label="Servers" value={p?.servers} accent="blue" hint="distinct servers" />
      </div>

      <Panel title="Over time" className={updating ? "is-updating" : ""}>
        {d ? <BucketChart buckets={d.buckets} {...chartLabels(windowId)} /> : !detail.error && <div className="skeleton" />}
      </Panel>

      <div className={updating ? "drawer-grid is-updating" : "drawer-grid"}>
        <Panel title="Rules">
          {d ? (
            <CountList
              items={d.byRule.map((r) => ({ key: r.rule, label: r.rule, count: r.count }))}
              empty={`Nothing in the ${windowLong(windowId)}.`}
            />
          ) : (
            !detail.error && <div className="skeleton skeleton-short" />
          )}
        </Panel>
        <Panel title="Remotes">
          {d ? (
            <CountList
              items={d.byRemote.map((r) => ({ key: r.remote, label: r.remote, count: r.count }))}
              empty={`Nothing in the ${windowLong(windowId)}.`}
              mono
            />
          ) : (
            !detail.error && <div className="skeleton skeleton-short" />
          )}
        </Panel>
      </div>

      <Panel title="Timeline" action={<span className="muted">all time, newest first</span>}>
        <ViolationTimeline filter={{ playerId }} />
      </Panel>
    </Drawer>
  );
}
