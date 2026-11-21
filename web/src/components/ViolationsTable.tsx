import type { Violation } from "../api/client";
import { formatDateTime } from "../lib/format";
import { ModeBadge } from "./ModeBadge";

export function ViolationsTable({ items }: { items: Violation[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Mode</th>
            <th>Rule</th>
            <th>Remote</th>
            <th>Player</th>
            <th>Detail</th>
            <th>Server</th>
          </tr>
        </thead>
        <tbody>
          {items.map((v) => (
            <tr key={v.id}>
              <td className="nowrap">{formatDateTime(v.occurredAt)}</td>
              <td>
                <ModeBadge mode={v.mode} />
              </td>
              <td className="rule">{v.rule}</td>
              <td className="mono">{v.remote}</td>
              <td>
                {v.playerName} <span className="muted">({v.playerId})</span>
              </td>
              <td className="detail">{v.detail}</td>
              <td className="mono muted" title={v.serverId}>
                {v.serverId.slice(0, 8)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
