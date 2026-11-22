/*
  Ingestion & keys: is data arriving, what is being refused and why, which game servers are
  sending (all with the read key, refreshed every 15s), and key management below it (with an
  admin key the person types in; see KeysPanel).
*/
import { useState } from "react";
import { ingestionApi, type RejectReason, type WindowId } from "../api/client";
import { CountList } from "../components/CountList";
import { IngestionChart, REASON_LABELS } from "../components/IngestionChart";
import { KeysPanel } from "../components/KeysPanel";
import { KpiCard } from "../components/KpiCard";
import { Empty, Panel } from "../components/Panel";
import { ServersTable } from "../components/ServersTable";
import { WindowSelect } from "../components/WindowSelect";
import { usePolling } from "../hooks/usePolling";
import { formatNumber } from "../lib/format";
import { chartLabels, windowLong } from "../lib/windows";

const POLL_MS = 15_000;

export function Ingestion() {
  const [windowId, setWindowId] = useState<WindowId>("24h");
  const overview = usePolling((s) => ingestionApi.overview(windowId, s), POLL_MS, windowId);
  const servers = usePolling((s) => ingestionApi.servers(windowId, s), POLL_MS, windowId);
  // Last window's numbers stay (dimmed) while the new window loads, but never after that failed.
  const o = overview.stale && !overview.loading ? undefined : overview.data;
  const sv = servers.stale && !servers.loading ? undefined : servers.data;
  const updating = overview.loading || overview.stale;
  const error = overview.error ?? servers.error;
  const labels = chartLabels(windowId);
  const silent = sv?.items.filter((s) => s.silent).length ?? 0;

  const reasons =
    o &&
    (Object.keys(o.totals.byReason) as RejectReason[])
      .filter((r) => o.totals.byReason[r] > 0)
      .sort((a, b) => o.totals.byReason[b] - o.totals.byReason[a])
      .map((r) => ({ key: r, label: REASON_LABELS[r], count: o.totals.byReason[r] }));

  return (
    <>
      <div className="page-toolbar">
        <h1 className="page-title">Ingestion</h1>
        <WindowSelect value={windowId} onChange={setWindowId} />
      </div>
      {error && <div className="banner">Couldn&apos;t load ingestion data: {error}</div>}

      <div className={updating ? "kpis is-updating" : "kpis"}>
        <KpiCard label="Accepted events" value={o?.totals.accepted} accent="blue" hint={`received, ${windowLong(windowId)}`} />
        <KpiCard label="Refused requests" value={o?.totals.rejected} accent="red" hint="using this game's keys" />
        <KpiCard
          label="Servers sending"
          value={sv?.items.length}
          accent="blue"
          hint={sv ? `${formatNumber(silent)} silent > ${sv.silentAfterMinutes} min` : undefined}
        />
        <KpiCard
          label="Unknown-key requests"
          value={o?.unattributedBadKey.count}
          accent="amber"
          hint="all games on this server, not just yours"
        />
      </div>

      <div className="grid-overview">
        <Panel title={`Accepted vs refused, ${windowLong(windowId)}`} className="span-2">
          {o ? (
            <div className={updating ? "is-updating" : undefined}>
              <IngestionChart
                buckets={o.buckets}
                tickEvery={labels.tickEvery}
                formatTick={labels.formatTick}
                formatReadout={labels.formatReadout}
                ariaLabel={`Accepted events and refused requests, ${windowLong(windowId)}`}
              />
            </div>
          ) : error ? null : (
            <div className="skeleton" />
          )}
        </Panel>
        <Panel title="Refused, by reason">
          {reasons ? (
            <CountList items={reasons} empty="Nothing refused with this game's keys." />
          ) : error ? null : (
            <div className="skeleton skeleton-short" />
          )}
          <p className="muted footnote">
            Requests whose key matched nothing can&apos;t be tied to a game, so they&apos;re only in the server-wide
            &ldquo;Unknown-key requests&rdquo; count above.
          </p>
        </Panel>
        <Panel title="Game servers" className="span-3">
          {!sv ? (
            error ? null : <div className="skeleton skeleton-short" />
          ) : sv.items.length === 0 ? (
            <Empty>No server sent events in the {windowLong(windowId)}.</Empty>
          ) : (
            <>
              <ServersTable rows={sv.items} silentAfterMinutes={sv.silentAfterMinutes} updating={servers.loading || servers.stale} />
              <div className="table-footer">
                <span className="muted">
                  {sv.truncated ? `Showing the ${formatNumber(sv.items.length)} most recent servers` : `${formatNumber(sv.items.length)} servers`} ·
                  &ldquo;silent&rdquo; means nothing received for {sv.silentAfterMinutes}+ minutes (shut down, or no violations
                  to report) · refreshes every 15s
                </span>
              </div>
            </>
          )}
        </Panel>
      </div>

      <div className="page-toolbar page-toolbar-spaced">
        <h1 className="page-title">Keys</h1>
      </div>
      <div className="keys-stack">
        <KeysPanel />
      </div>
    </>
  );
}
