import { useEffect, useState } from "react";

export interface PollState<T> {
  data: T | undefined;
  error: string | undefined;
  // True from a (re)start until its first response; background refreshes don't set it, so
  // screens can dim stale data while a new filter loads instead of flashing a skeleton.
  loading: boolean;
}

/*
  Calls `fetcher` now and then every `intervalMs` after the previous call finishes
  (so slow responses never pile up). Pass intervalMs = 0 to fetch once.
  `key` restarts polling when it changes (e.g. a filter). `enabled = false` stops polling and
  keeps the last data (e.g. while the user is paging further down a list).
  Unmounting aborts the in-flight call.
*/
export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  key = "",
  enabled = true,
): PollState<T> {
  const [state, setState] = useState<PollState<T>>({ data: undefined, error: undefined, loading: true });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState((prev) => (prev.loading ? prev : { ...prev, loading: true }));

    const tick = async () => {
      try {
        const data = await fetcher(controller.signal);
        setState({ data, error: undefined, loading: false });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState((prev) => ({ data: prev.data, error: (err as Error).message, loading: false }));
      }
      if (intervalMs > 0 && !controller.signal.aborted) timer = setTimeout(tick, intervalMs);
    };
    tick();

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // The fetcher is re-created each render; `key` is the explicit restart signal.
  }, [intervalMs, key, enabled]);

  return state;
}
