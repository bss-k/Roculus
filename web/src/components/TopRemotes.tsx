import type { RemoteCount } from "../api/client";
import { formatNumber } from "../lib/format";
import { Empty } from "./Panel";

// One tile per remote: how many calls broke a rule, with a bar relative to the most attacked one.
export function TopRemotes({ remotes }: { remotes: RemoteCount[] }) {
  if (remotes.length === 0) return <Empty>No attacked remotes in the last 24h.</Empty>;
  const max = remotes[0]!.count;
  return (
    <ol className="tiles">
      {remotes.map((r) => (
        <li key={r.remote} className="tile">
          <span className="tile-count">{formatNumber(r.count)}</span>
          <div className="meter">
            <div className="meter-fill" style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
          <span className="tile-name" title={r.remote}>
            {r.remote}
          </span>
        </li>
      ))}
    </ol>
  );
}
