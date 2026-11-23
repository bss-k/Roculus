import { api } from "../api/client";
import { HourlyChart } from "../components/HourlyChart";
import { LiveFeed } from "../components/LiveFeed";
import { OverviewSummary } from "../components/OverviewSummary";
import { Panel } from "../components/Panel";
import { TopRemotes } from "../components/TopRemotes";
import { usePolling } from "../hooks/usePolling";

const POLL_MS = 5000;

export function Overview() {
  const summary = usePolling((s) => api.summary(s), POLL_MS);
  const hourly = usePolling((s) => api.hourly(s), POLL_MS);
  const remotes = usePolling((s) => api.topRemotes(6, s), POLL_MS);
  const feed = usePolling((s) => api.violations({ limit: 8 }, s), POLL_MS);
  const error = summary.error ?? hourly.error ?? remotes.error ?? feed.error;

  return (
    <>
      {error && <div className="banner">Can't reach the API: {error}</div>}
      <OverviewSummary summary={summary.data} />
      <Panel title="Per hour">
        {hourly.data ? <HourlyChart hours={hourly.data} /> : <div className="skeleton" />}
      </Panel>
      <Panel title="Most attacked remotes">
        {remotes.data ? <TopRemotes remotes={remotes.data} /> : <div className="skeleton skeleton-short" />}
      </Panel>
      <Panel
        title="Latest violations"
        action={
          <span className="live">
            <span className="live-dot" aria-hidden />
            Live
          </span>
        }
      >
        {feed.data ? <LiveFeed items={feed.data.items} /> : <div className="skeleton" />}
      </Panel>
    </>
  );
}
