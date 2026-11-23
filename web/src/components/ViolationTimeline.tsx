/*
  One player's or one remote's violations, newest first, paged with the keyset cursor from
  GET /v1/violations. Loads once per filter and never refreshes on its own (it lives in a drawer).
*/
import { useEffect, useState } from "react";
import { api, type Violation } from "../api/client";
import { formatDateTime } from "../lib/format";
import { ModeBadge } from "./ModeBadge";
import { Empty } from "./Panel";

const PAGE_SIZE = 20;

type Filter = { playerId: number } | { remote: string };

export function ViolationTimeline({ filter }: { filter: Filter }) {
  const [items, setItems] = useState<Violation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const byPlayer = "playerId" in filter;
  const filterKey = byPlayer ? `p:${filter.playerId}` : `r:${filter.remote}`;

  // First page whenever the filter changes (or Retry is clicked).
  useEffect(() => {
    const controller = new AbortController();
    setItems([]);
    setCursor(null);
    setLoading(true);
    setError(undefined);
    api
      .violations({ ...filter, limit: PAGE_SIZE }, controller.signal)
      .then((page) => {
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((err: Error) => !controller.signal.aborted && setError(err.message))
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
    // `filter` is a fresh object each render; filterKey is its identity.
  }, [filterKey, attempt]);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await api.violations({ ...filter, limit: PAGE_SIZE, cursor });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (loading && items.length === 0) return <div className="skeleton skeleton-short" />;

  return (
    <>
      {error && (
        <div className="banner">
          Couldn't load violations: {error}{" "}
          <button type="button" className="btn-ghost btn-small" onClick={() => (items.length ? loadMore() : setAttempt((n) => n + 1))}>
            Retry
          </button>
        </div>
      )}
      {items.length === 0 && !error ? (
        <Empty>No violations recorded.</Empty>
      ) : (
        <ul className="feed timeline">
          {items.map((v) => (
            <li key={v.id}>
              <ModeBadge mode={v.mode} kind="result" />
              <div className="feed-body">
                <div>
                  {byPlayer ? (
                    <span className="mono">{v.remote}</span>
                  ) : (
                    <>
                      <strong>{v.playerName}</strong> <span className="muted">({v.playerId})</span>
                    </>
                  )}{" "}
                  <span className="rule">{v.rule}</span>
                </div>
                <div className="muted feed-detail" title={v.detail}>
                  {v.detail}
                </div>
              </div>
              <time className="muted" dateTime={v.occurredAt}>
                {formatDateTime(v.occurredAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <div className="table-footer">
          <span className="muted">{items.length} shown</span>
          <button type="button" className="btn" onClick={loadMore} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}
