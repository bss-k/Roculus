/*
  A ranked list of counts with meter bars (rule and remote breakdowns, top players). Same look as
  Overview's "Top attacked remotes". With onSelect, each row is a button.
*/
import type { ReactNode } from "react";
import { formatNumber } from "../lib/format";
import { Empty } from "./Panel";

export interface CountItem {
  key: string;
  label: ReactNode;
  count: number;
}

interface CountListProps {
  items: CountItem[];
  empty: string;
  onSelect?: (key: string) => void;
  mono?: boolean; // remote names read better in the monospace font
}

export function CountList({ items, empty, onSelect, mono = false }: CountListProps) {
  if (items.length === 0) return <Empty>{empty}</Empty>;
  const max = Math.max(...items.map((i) => i.count));
  return (
    <ol className="count-list">
      {items.map((item) => {
        const body = (
          <>
            <div className="top-remotes-row">
              <span className={mono ? "mono" : undefined}>{item.label}</span>
              <span>{formatNumber(item.count)}</span>
            </div>
            <div className="meter">
              <div className="meter-fill" style={{ width: `${(item.count / max) * 100}%` }} />
            </div>
          </>
        );
        return (
          <li key={item.key}>
            {onSelect ? (
              <button type="button" className="count-button" onClick={() => onSelect(item.key)}>
                {body}
              </button>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ol>
  );
}
