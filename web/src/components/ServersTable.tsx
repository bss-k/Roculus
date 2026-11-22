import type { ServerRow } from "../api/client";
import { formatDateTime, formatNumber, timeAgo } from "../lib/format";

// Game servers that sent events in the window, most recently heard from first.
export function ServersTable({ rows, silentAfterMinutes, updating }: { rows: ServerRow[]; silentAfterMinutes: number; updating: boolean }) {
  return (
    <div className={updating ? "table-wrap is-updating" : "table-wrap"}>
      <table>
        <thead>
          <tr>
            <th>Server (JobId)</th>
            <th>Status</th>
            <th className="num">Events</th>
            <th>First received</th>
            <th>Last received</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.serverId}>
              <td className="mono server-id">{s.serverId}</td>
              <td>
                {s.silent ? (
                  <span
                    className="badge badge-silent"
                    title={`Nothing received for over ${silentAfterMinutes} minutes. It may have shut down, or simply had no violations to report.`}
                  >
                    silent
                  </span>
                ) : (
                  <span className="badge badge-sending">sending</span>
                )}
              </td>
              <td className="num">{formatNumber(s.events)}</td>
              <td className="nowrap" title={formatDateTime(s.firstReceived)}>
                {timeAgo(s.firstReceived)}
              </td>
              <td className="nowrap" title={formatDateTime(s.lastReceived)}>
                {timeAgo(s.lastReceived)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
