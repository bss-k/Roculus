/*
  The time windows the Players and Remotes screens can show, and how each one is cut into
  chart buckets.

  Buckets are rolling: they end at the moment of the request ("asOf"), so N equal buckets tile
  the window exactly and the bars always add up to the totals. (Overview's hourly chart is
  clock-aligned instead, and keeps its own query.)
*/
const MINUTE = 60_000;

export const WINDOWS = {
  "1h": { bucketMs: 5 * MINUTE, buckets: 12 },
  "24h": { bucketMs: 60 * MINUTE, buckets: 24 },
  "7d": { bucketMs: 6 * 60 * MINUTE, buckets: 28 },
} as const;

export type WindowId = keyof typeof WINDOWS;
export const WINDOW_IDS = Object.keys(WINDOWS) as [WindowId, ...WindowId[]];

export interface TimeWindow {
  start: Date; // events with occurred_at >= start are in the window
  asOf: Date; // the request time; the newest bucket ends here
  bucketSeconds: number;
  buckets: number;
}

// One clock reading per request: every query of a response gets the same start, so totals
// and buckets can't disagree about an event right at the edge.
export function timeWindow(id: WindowId, asOf = new Date()): TimeWindow {
  const { bucketMs, buckets } = WINDOWS[id];
  return {
    start: new Date(asOf.getTime() - bucketMs * buckets),
    asOf,
    bucketSeconds: bucketMs / 1000,
    buckets,
  };
}
