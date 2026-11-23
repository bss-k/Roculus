import type { Summary } from "../api/client";
import { formatNumber, timeAgo } from "../lib/format";

/* Overview's opening: what the screen covers, then the five numbers that matter most. */
export function OverviewSummary({ summary }: { summary: Summary | undefined }) {
  const servers = summary ? `${formatNumber(summary.uniqueServers)} ${summary.uniqueServers === 1 ? "server" : "servers"}` : "your servers";
  const stats: { label: string; value: string | undefined; tone?: "red" | "amber" }[] = [
    { label: "Violations", value: summary && formatNumber(summary.total) },
    { label: "Blocked", value: summary && formatNumber(summary.enforced), tone: "red" },
    { label: "Logged only", value: summary && formatNumber(summary.shadowed), tone: "amber" },
    { label: "Players flagged", value: summary && formatNumber(summary.uniquePlayers) },
    { label: "Latest", value: summary && (summary.lastEventAt ? timeAgo(summary.lastEventAt) : "none yet") },
  ];
  return (
    <section className="summary">
      <div>
        <h1 className="summary-title">Last 24 hours</h1>
        <p className="summary-sub">Remote-Guard activity across {servers}, updated live</p>
      </div>
      <dl className="stats">
        {stats.map((s) => (
          <div key={s.label} className={s.tone ? `stat stat-${s.tone}` : "stat"}>
            <dt>{s.label}</dt>
            <dd>{s.value ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
