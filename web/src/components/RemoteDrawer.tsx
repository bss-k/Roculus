/*
  Drawer with one remote's details. Fetches once per (remote, window): open drawers don't
  refresh on their own. Clicking a top player hands over to that player's drawer.
*/
import { useState } from "react";
import { api, type WindowId } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { timeAgo } from "../lib/format";
import { chartLabels, windowLong } from "../lib/windows";
import { BucketChart } from "./BucketChart";
import { CountList } from "./CountList";
import { Drawer } from "./Drawer";
import { KpiCard } from "./KpiCard";
import { ModeBadge } from "./ModeBadge";
import { Panel } from "./Panel";
import { ViolationTimeline } from "./ViolationTimeline";
import { WindowSelect } from "./WindowSelect";

interface RemoteDrawerProps {
  remote: string;
  initialWindow: WindowId;
  onClose: () => void;
  // Opens the player's drawer in place of this one, at this drawer's current window.
  onOpenPlayer: (player: { playerId: number; playerName: string }, window: WindowId) => void;
}

export function RemoteDrawer({ remote, initialWindow, onClose, onOpenPlayer }: RemoteDrawerProps) {
  const [windowId, setWindowId] = useState<WindowId>(initialWindow);
  const detail = usePolling((signal) => api.remote(remote, windowId, signal), 0, `${remote}|${windowId}`);
  const d = detail.data;
  const r = d?.remote;
  const updating = detail.loading && d !== undefined;
  const nothing = `Nothing in the ${windowLong(windowId)}.`;

  function openPlayer(key: string) {
    const player = d?.topPlayers.find((p) => String(p.playerId) === key);
    if (player) onOpenPlayer(player, windowId);
  }

  return (
    <Drawer
      title={<span className="mono">{remote}</span>}
      subtitle={
        <span className="drawer-subtitle">
          Remote
          {r && (
            <>
              {" "}
              · current mode <ModeBadge mode={r.mode} />
            </>
          )}
          {r?.lastSeen && <> · last hit {timeAgo(r.lastSeen)}</>}
        </span>
      }
      onClose={onClose}
    >
      <div className="drawer-toolbar">
        <WindowSelect value={windowId} onChange={setWindowId} />
        {updating && <span className="muted">Updating…</span>}
      </div>
      {detail.error && <div className="banner">{detail.error}</div>}

      <div className={updating ? "kpis is-updating" : "kpis"}>
        <KpiCard label={`Violations (${windowId})`} value={r?.total} accent="blue" />
        <KpiCard label="Enforced" value={r?.enforced} accent="red" hint="calls dropped" />
        <KpiCard label="Shadow" value={r?.shadowed} accent="amber" hint="logged, still ran" />
        <KpiCard label="Players" value={r?.uniquePlayers} accent="blue" hint="unique player IDs" />
      </div>

      <Panel title="Over time" className={updating ? "is-updating" : ""}>
        {d ? <BucketChart buckets={d.buckets} {...chartLabels(windowId)} /> : !detail.error && <div className="skeleton" />}
      </Panel>

      <div className={updating ? "drawer-grid is-updating" : "drawer-grid"}>
        <Panel title="Rules">
          {d ? (
            <CountList items={d.byRule.map((x) => ({ key: x.rule, label: x.rule, count: x.count }))} empty={nothing} />
          ) : (
            !detail.error && <div className="skeleton skeleton-short" />
          )}
        </Panel>
        <Panel title="Top players">
          {d ? (
            <CountList
              items={d.topPlayers.map((p) => ({
                key: String(p.playerId),
                label: (
                  <>
                    {p.playerName}
                    {p.enforced > 0 && <span className="num-enforce"> · {p.enforced} enforced</span>}
                  </>
                ),
                count: p.total,
              }))}
              empty={nothing}
              onSelect={openPlayer}
            />
          ) : (
            !detail.error && <div className="skeleton skeleton-short" />
          )}
        </Panel>
      </div>

      <Panel title="Timeline" action={<span className="muted">all time, newest first</span>}>
        <ViolationTimeline filter={{ remote }} />
      </Panel>
    </Drawer>
  );
}
