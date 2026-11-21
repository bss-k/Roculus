import { useEffect, useState } from "react";
import { api, type Violation } from "../api/client";
import { Empty, Panel } from "../components/Panel";
import { ViolationsTable } from "../components/ViolationsTable";
import { usePolling } from "../hooks/usePolling";
import { formatNumber } from "../lib/format";

const PAGE_SIZE = 50;

export function Violations() {
  const [rule, setRule] = useState("");
  const [items, setItems] = useState<Violation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);
  const rules = usePolling((s) => api.summary(s).then((r) => r.byRule), 0);

  // First page whenever the filter changes (or Refresh is clicked).
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api
      .violations({ rule: rule || undefined, limit: PAGE_SIZE }, controller.signal)
      .then((page) => {
        setItems(page.items);
        setCursor(page.nextCursor);
        setError(undefined);
      })
      .catch((err: Error) => !controller.signal.aborted && setError(err.message))
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [rule, reloadKey]);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await api.violations({ rule: rule || undefined, limit: PAGE_SIZE, cursor });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const filters = (
    <div className="filters">
      <label>
        Rule{" "}
        <select value={rule} onChange={(e) => setRule(e.target.value)}>
          <option value="">All rules</option>
          {rules.data?.map((r) => (
            <option key={r.rule} value={r.rule}>
              {r.rule} ({formatNumber(r.count)} in 24h)
            </option>
          ))}
        </select>
      </label>
      <button className="btn-ghost" onClick={() => setReloadKey((k) => k + 1)}>
        Refresh
      </button>
    </div>
  );

  return (
    <Panel title="Violations" action={filters}>
      {error && <div className="banner">{error}</div>}
      {items.length > 0 ? <ViolationsTable items={items} /> : !loading && <Empty>No violations match this filter.</Empty>}
      <div className="table-footer">
        <span className="muted">{formatNumber(items.length)} shown</span>
        {cursor && (
          <button className="btn" onClick={loadMore} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </Panel>
  );
}
