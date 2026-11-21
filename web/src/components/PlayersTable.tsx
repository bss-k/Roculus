import type { MouseEvent } from "react";
import type { PlayerRow } from "../api/client";
import { formatDateTime, formatNumber, timeAgo } from "../lib/format";

interface PlayersTableProps {
  rows: PlayerRow[];
  updating: boolean;
  onOpen: (player: PlayerRow) => void;
}

export function PlayersTable({ rows, updating, onOpen }: PlayersTableProps) {
  // A click anywhere on the row focuses its name button first, so when the drawer closes,
  // focus returns to this row (for mouse users as well as keyboard users).
  function openRow(event: MouseEvent<HTMLTableRowElement>, player: PlayerRow) {
    event.currentTarget.querySelector("button")?.focus();
    onOpen(player);
  }

  return (
    <div className={updating ? "table-wrap is-updating" : "table-wrap"}>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th className="num">Violations</th>
            <th className="num">Enforced</th>
            <th className="num">Shadow</th>
            <th>Rules</th>
            <th className="num">Remotes</th>
            <th>First seen</th>
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.playerId} className="row-link" onClick={(e) => openRow(e, p)}>
              <td>
                <button
                  type="button"
                  className="link-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(p);
                  }}
                >
                  {p.playerName}
                </button>{" "}
                <span className="muted">({p.playerId})</span>
              </td>
              <td className="num">{formatNumber(p.total)}</td>
              <td className="num num-enforce">{formatNumber(p.enforced)}</td>
              <td className="num num-shadow">{formatNumber(p.shadowed)}</td>
              <td>
                <span className="chips">
                  {p.rules.map((rule) => (
                    <span key={rule} className="chip">
                      {rule}
                    </span>
                  ))}
                </span>
              </td>
              <td className="num">{formatNumber(p.remotes)}</td>
              <td className="nowrap muted" title={formatDateTime(p.firstSeen)}>
                {timeAgo(p.firstSeen)}
              </td>
              <td className="nowrap" title={formatDateTime(p.lastSeen)}>
                {timeAgo(p.lastSeen)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
