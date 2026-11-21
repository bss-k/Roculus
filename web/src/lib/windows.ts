/*
  The 1h / 24h / 7d windows as the dashboard shows them. Bucket sizes mirror
  api/src/lib/windows.ts; they're only used here to label the bars.
*/
import type { WindowId } from "../api/client";
import { formatDay, formatTime } from "./format";

export const WINDOW_OPTIONS: { id: WindowId; label: string; long: string }[] = [
  { id: "1h", label: "1h", long: "last hour" },
  { id: "24h", label: "24h", long: "last 24 hours" },
  { id: "7d", label: "7d", long: "last 7 days" },
];

const MINUTE = 60_000;
const BUCKET_MS: Record<WindowId, number> = { "1h": 5 * MINUTE, "24h": 60 * MINUTE, "7d": 6 * 60 * MINUTE };

export const windowLong = (id: WindowId) => WINDOW_OPTIONS.find((w) => w.id === id)!.long;

// Props for BucketChart: how often to label a bar, and how to word its time range.
export function chartLabels(id: WindowId) {
  const end = (start: string) => new Date(Date.parse(start) + BUCKET_MS[id]).toISOString();
  if (id === "7d") {
    return {
      tickEvery: 4, // one label per day
      formatTick: formatDay,
      formatReadout: (start: string) => `${formatDay(start)} ${formatTime(start)} – ${formatTime(end(start))}`,
      ariaLabel: "Violations per 6 hours, last 7 days",
    };
  }
  return {
    tickEvery: 3,
    formatTick: formatTime,
    formatReadout: (start: string) => `${formatTime(start)} – ${formatTime(end(start))}`,
    ariaLabel: id === "1h" ? "Violations per 5 minutes, last hour" : "Violations per hour, last 24 hours",
  };
}
