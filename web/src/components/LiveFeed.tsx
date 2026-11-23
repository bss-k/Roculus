import { useEffect, useRef } from "react";
import type { Violation } from "../api/client";
import { timeAgo } from "../lib/format";
import { ModeBadge } from "./ModeBadge";
import { Empty } from "./Panel";

// Two letters for the avatar circle: the first letters in the player's name.
const initials = (name: string) => (name.replace(/[^A-Za-z]/g, "").slice(0, 2) || name.slice(0, 2)).toUpperCase();

export function LiveFeed({ items }: { items: Violation[] }) {
  // Rows that arrive after the first load slide in; the first load doesn't animate row by row.
  const seen = useRef<Set<number> | null>(null);
  const known = seen.current;
  useEffect(() => {
    seen.current = new Set(items.map((v) => v.id));
  }, [items]);

  if (items.length === 0) return <Empty>Waiting for events…</Empty>;
  return (
    <ul className="feed">
      {items.map((v) => (
        <li key={v.id} className={known && !known.has(v.id) ? "row-new" : undefined}>
          <span className="avatar" aria-hidden>
            {initials(v.playerName)}
          </span>
          <div className="feed-body">
            <div className="feed-who">{v.playerName}</div>
            <div className="feed-detail">
              {v.remote}, <span className="rule">{v.rule}</span>: {v.detail}
            </div>
          </div>
          <div className="feed-meta">
            <ModeBadge mode={v.mode} kind="result" />
            <time dateTime={v.occurredAt}>{timeAgo(v.occurredAt)}</time>
          </div>
        </li>
      ))}
    </ul>
  );
}
