import type { RemoteCount } from "../api/client";
import { formatNumber } from "../lib/format";
import { Empty } from "./Panel";

export function TopRemotes({ remotes }: { remotes: RemoteCount[] }) {
  if (remotes.length === 0) return <Empty>No attacked remotes in the last 24h.</Empty>;
  const max = remotes[0]!.count;
  return (
    <ol className="top-remotes">
      {remotes.map((r) => (
        <li key={r.remote}>
          <div className="top-remotes-row">
            <span className="mono">{r.remote}</span>
            <span>{formatNumber(r.count)}</span>
          </div>
          <div className="meter">
            <div className="meter-fill" style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
}
