import { api } from "../api/client";
import { HourlyChart } from "../components/HourlyChart";
import { KpiCard } from "../components/KpiCard";
import { LiveFeed } from "../components/LiveFeed";
import { Panel } from "../components/Panel";
import { TopRemotes } from "../components/TopRemotes";
import { usePolling } from "../hooks/usePolling";
import { formatNumber } from "../lib/format";

const POLL_MS = 5000;

export function Overview() {
  const summary = usePolling((s) => api.summary(s), POLL_MS);
  const hourly = usePolling((s) => api.hourly(s), POLL_MS);
  const remotes = usePolling((s) => api.topRemotes(6, s), POLL_MS);
  const feed = usePolling((s) => api.violations({ limit: 12 }, s), POLL_MS);
  const error = summary.error ?? hourly.error ?? remotes.error ?? feed.error;
  const s = summary.data;

  return (
    <>
      {error && <div className="banner">Can't reach the API: {error}</div>}
      <div className="kpis">
        <KpiCard label="Violations (24h)" value={s?.total} accent="blue" hint={s && `${formatNumber(s.uniqueServers)} servers`} />
        <KpiCard label="Enforced" value={s?.enforced} accent="red" hint="calls dropped" />
        <KpiCard label="Shadow" value={s?.shadowed} accent="amber" hint="logged, still ran" />
        <KpiCard label="Players flagged" value={s?.uniquePlayers} accent="blue" hint="unique player IDs" />
      </div>
      <div className="grid-overview">
        <Panel title="Violations per hour" className="span-2">
          {hourly.data ? <HourlyChart hours={hourly.data} /> : <div className="skeleton" />}
        </Panel>
        <Panel title="Top attacked remotes">
          {remotes.data ? <TopRemotes remotes={remotes.data} /> : <div className="skeleton" />}
        </Panel>
        <Panel title="Live feed" action={<span className="live">● live</span>} className="span-3">
          {feed.data ? <LiveFeed items={feed.data.items} /> : <div className="skeleton" />}
        </Panel>
      </div>
    </>
  );
}
