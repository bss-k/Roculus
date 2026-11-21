/*
  Players screen: who is setting off Remote-Guard, ranked over a 1h / 24h / 7d window.

  Page 1 refreshes every 15s. "Load more" fetches further pages (offset paging) and pauses the
  refresh, so rows don't move while you read; Refresh starts over from page 1.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type PlayerRow, type PlayerSort, type WindowId } from "../api/client";
import { Empty, Panel } from "../components/Panel";
import { PlayerDrawer } from "../components/PlayerDrawer";
import { PlayersTable } from "../components/PlayersTable";
import { WindowSelect } from "../components/WindowSelect";
import { useDebounced } from "../hooks/useDebounced";
import { usePolling } from "../hooks/usePolling";
import { formatNumber } from "../lib/format";
import { windowLong } from "../lib/windows";

const PAGE_SIZE = 25;
const POLL_MS = 15_000;
const MAX_OFFSET = 1000; // the API's offset cap: past this, narrow the search instead

const SORTS: { id: PlayerSort; label: string }[] = [
  { id: "total", label: "Most violations" },
  { id: "enforced", label: "Most enforced" },
  { id: "lastSeen", label: "Most recent" },
];

export function Players() {
  const [windowId, setWindowId] = useState<WindowId>("24h");
  const [sort, setSort] = useState<PlayerSort>("total");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const key = `${windowId}|${sort}|${q}`;

  // Rows beyond page 1, fetched with "Load more". While there are any, polling is paused.
  const [more, setMore] = useState<PlayerRow[]>([]);
  const [moreOffset, setMoreOffset] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string>();
  const [capped, setCapped] = useState(false); // stopped at the API's offset cap, more may exist
  const [selected, setSelected] = useState<PlayerRow | null>(null);

  const first = usePolling(
    (signal) => api.players({ window: windowId, sort, q: q || undefined, limit: PAGE_SIZE }, signal),
    POLL_MS,
    key,
    !paused,
  );
  // Page 1 for the current filters (not the previous filters' page still on screen).
  const fresh = first.data !== undefined && !first.stale;

  // Bumped whenever the list starts over (new filters or Refresh). An in-flight "Load more"
  // that finishes after that belongs to the old list, so it drops its rows.
  const generation = useRef(0);
  function resetPaging() {
    generation.current += 1;
    setMore([]);
    setMoreOffset(null);
    setMoreError(undefined);
    setCapped(false);
    setLoadingMore(false);
    setPaused(false); // re-enables polling, which fetches page 1 right away
  }
  useEffect(resetPaging, [key]);

  // "Load more" continues from page 1 only once page 1 matches the current filters.
  const nextOffset = paused ? moreOffset : fresh ? first.data!.nextOffset : null;

  async function loadMore() {
    if (nextOffset === null) return;
    const started = generation.current;
    setLoadingMore(true);
    try {
      const page = await api.players({ window: windowId, sort, q: q || undefined, limit: PAGE_SIZE, offset: nextOffset });
      if (generation.current !== started) return;
      setPaused(true);
      setMore((prev) => [...prev, ...page.items]);
      setMoreOffset(page.nextOffset);
      // A full page with no next offset because the next one would pass the cap: there may be more.
      setCapped(page.nextOffset === null && page.items.length === PAGE_SIZE && nextOffset + PAGE_SIZE > MAX_OFFSET);
      setMoreError(undefined);
    } catch (err) {
      if (generation.current === started) setMoreError((err as Error).message);
    } finally {
      if (generation.current === started) setLoadingMore(false);
    }
  }

  // Previous filters' rows stay on screen (dimmed) while the new ones load, but not after the
  // new request failed: then they would look like results for the new filters.
  const showPageOne = fresh || first.loading;

  // Offset pages can overlap when counts change between requests: show each player once.
  const rows = useMemo(() => {
    const seen = new Set<number>();
    return [...(showPageOne ? (first.data?.items ?? []) : []), ...more].filter((p) => {
      if (seen.has(p.playerId)) return false;
      seen.add(p.playerId);
      return true;
    });
  }, [showPageOne, first.data, more]);

  const filters = (
    <div className="filters">
      <WindowSelect value={windowId} onChange={setWindowId} />
      <input
        type="search"
        className="search"
        placeholder="Name or player ID"
        aria-label="Search players by name prefix or exact player ID"
        value={search}
        maxLength={32}
        onChange={(e) => setSearch(e.target.value)}
      />
      <label>
        Sort{" "}
        <select value={sort} onChange={(e) => setSort(e.target.value as PlayerSort)}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  let body;
  if (!first.data) {
    body = first.error ? null : <div className="skeleton" />;
  } else if (!fresh && !first.loading) {
    body = null; // the new filters' request failed; the banner says so
  } else if (rows.length === 0) {
    body = (
      <Empty>
        {q ? `No players match “${q}” in the ${windowLong(windowId)}.` : `No flagged players in the ${windowLong(windowId)}.`}
      </Empty>
    );
  } else {
    body = <PlayersTable rows={rows} updating={first.loading || first.stale} onOpen={setSelected} />;
  }

  return (
    <>
      <Panel title="Players" action={filters}>
        {first.error && (
          <div className="banner">
            {fresh ? "Couldn't refresh: " : "Couldn't load players: "}
            {first.error}
          </div>
        )}
        {body}
        {rows.length > 0 && (
          <div className="table-footer">
            <span className="muted">
              {formatNumber(rows.length)} players ·{" "}
              {paused ? (
                <>
                  auto-refresh paused while you browse
                  <button type="button" className="btn-ghost btn-small" onClick={resetPaging}>
                    Refresh
                  </button>
                </>
              ) : (
                "refreshes every 15s"
              )}
              {capped && " · list stops here; narrow the search to see the rest"}
            </span>
            {moreError && <span className="error-text">Couldn't load more: {moreError}</span>}
            {nextOffset !== null && (
              <button type="button" className="btn" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        )}
      </Panel>
      {selected && (
        <PlayerDrawer
          playerId={selected.playerId}
          playerName={selected.playerName}
          initialWindow={windowId}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
