import type { MouseEvent } from "react";
import type { RemoteRow } from "../api/client";
import { formatDateTime, formatNumber, timeAgo } from "../lib/format";
import { ModeBadge } from "./ModeBadge";
import { Sparkline } from "./Sparkline";

const RULE_CHIPS = 3; // the rest are in the drawer

interface RemotesTableProps {
  rows: RemoteRow[];
  updating: boolean;
  onOpen: (remote: RemoteRow) => void;
}

export function RemotesTable({ rows, updating, onOpen }: RemotesTableProps) {
  // Same as PlayersTable: focus the row's button first so focus returns here after the drawer.
  function openRow(event: MouseEvent<HTMLTableRowElement>, remote: RemoteRow) {
    event.currentTarget.querySelector("button")?.focus();
    onOpen(remote);
  }

  return (
    <div className={updating ? "table-wrap is-updating" : "table-wrap"}>
      <table>
        <thead>
          <tr>
            <th>Remote</th>
            <th>Mode</th>
            <th className="num">Violations</th>
            <th className="num">Enforced</th>
            <th className="num">Shadow</th>
            <th className="num">Players</th>
            <th>Rules</th>
            <th>Trend</th>
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.remote} className="row-link" onClick={(e) => openRow(e, r)}>
              <td className="remote-name">
                <button
                  type="button"
                  className="link-button mono"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(r);
                  }}
                >
                  {r.remote}
                </button>
              </td>
              <td>
                <ModeBadge mode={r.mode} />
              </td>
              <td className="num">{formatNumber(r.total)}</td>
              <td className="num num-enforce">{formatNumber(r.enforced)}</td>
              <td className="num num-shadow">{formatNumber(r.shadowed)}</td>
              <td className="num">{formatNumber(r.uniquePlayers)}</td>
              <td>
                <span className="chips">
                  {r.byRule.slice(0, RULE_CHIPS).map((rule) => (
                    <span key={rule.rule} className="chip">
                      {rule.rule} <span className="chip-count">{formatNumber(rule.count)}</span>
                    </span>
                  ))}
                  {r.byRule.length > RULE_CHIPS && <span className="muted">+{r.byRule.length - RULE_CHIPS}</span>}
                </span>
              </td>
              <td>
                <Sparkline buckets={r.buckets} />
              </td>
              <td className="nowrap" title={formatDateTime(r.lastSeen)}>
                {timeAgo(r.lastSeen)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
