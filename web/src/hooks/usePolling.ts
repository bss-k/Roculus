import { useEffect, useState } from "react";

export interface PollState<T> {
  data: T | undefined;
  error: string | undefined;
}

/*
  Calls `fetcher` now and then every `intervalMs` after the previous call finishes
  (so slow responses never pile up). Pass intervalMs = 0 to fetch once.
  `key` restarts polling when it changes (e.g. a filter). Unmounting aborts the in-flight call.
*/
export function usePolling<T>(fetcher: (signal: AbortSignal) => Promise<T>, intervalMs: number, key = ""): PollState<T> {
  const [state, setState] = useState<PollState<T>>({ data: undefined, error: undefined });

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const data = await fetcher(controller.signal);
        setState({ data, error: undefined });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState((prev) => ({ data: prev.data, error: (err as Error).message }));
      }
      if (intervalMs > 0 && !controller.signal.aborted) timer = setTimeout(tick, intervalMs);
    };
    tick();

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // The fetcher is re-created each render; `key` is the explicit restart signal.
  }, [intervalMs, key]);

  return state;
}
