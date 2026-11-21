const numberFormat = new Intl.NumberFormat("en-US");

export const formatNumber = (n: number) => numberFormat.format(n);

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export const formatHour = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", hour12: true }).replace(" ", "").toLowerCase();

// "3:47pm": rolling buckets rarely start on the hour, so the minutes matter.
export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true }).replace(" ", "").toLowerCase();

export const formatDay = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
