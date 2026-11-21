import type { Violation } from "../api/client";
import { timeAgo } from "../lib/format";
import { ModeBadge } from "./ModeBadge";
import { Empty } from "./Panel";

export function LiveFeed({ items }: { items: Violation[] }) {
  if (items.length === 0) return <Empty>Waiting for events…</Empty>;
  return (
    <ul className="feed">
      {items.map((v) => (
        <li key={v.id}>
          <ModeBadge mode={v.mode} />
          <div className="feed-body">
            <div>
              <strong>{v.playerName}</strong> <span className="muted">→</span> <span className="mono">{v.remote}</span>{" "}
              <span className="rule">{v.rule}</span>
            </div>
            <div className="muted feed-detail">{v.detail}</div>
          </div>
          <time className="muted" dateTime={v.occurredAt}>
            {timeAgo(v.occurredAt)}
          </time>
        </li>
      ))}
    </ul>
  );
}
