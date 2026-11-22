/*
  Accepted events per time bucket (blue bars, left axis) with refused requests overlaid (narrow
  red bars, right axis). Two axes because they're different units, and refusals are usually far
  fewer: on one shared axis the red bars would be invisible. Hover a bucket for exact numbers.
*/
import { useState } from "react";
import type { IngestionBucket, RejectReason } from "../api/client";
import { formatNumber } from "../lib/format";
import { niceMax } from "./BucketChart";

const WIDTH = 720;
const HEIGHT = 220;
const PAD = { top: 12, right: 40, bottom: 24, left: 44 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

export const REASON_LABELS: Record<RejectReason, string> = {
  bad_key: "Bad, expired or wrong-scope key",
  invalid_schema: "Invalid payload",
  rate_limited: "Rate limited",
  too_large: "Body too large",
};

interface IngestionChartProps {
  buckets: IngestionBucket[];
  tickEvery: number;
  formatTick: (start: string) => string;
  formatReadout: (start: string) => string;
  ariaLabel: string;
}

export function IngestionChart({ buckets, tickEvery, formatTick, formatReadout, ariaLabel }: IngestionChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const maxAccepted = niceMax(Math.max(...buckets.map((b) => b.accepted)));
  const maxRejected = niceMax(Math.max(...buckets.map((b) => b.rejected)));
  const slot = PLOT_W / buckets.length;
  const yLeft = (v: number) => PAD.top + PLOT_H - (v / maxAccepted) * PLOT_H;
  const yRight = (v: number) => PAD.top + PLOT_H - (v / maxRejected) * PLOT_H;
  const active = hovered === null ? null : buckets[hovered];

  function readout(b: IngestionBucket) {
    const reasons = (Object.keys(b.byReason) as RejectReason[])
      .filter((r) => b.byReason[r] > 0)
      .map((r) => `${formatNumber(b.byReason[r])} ${REASON_LABELS[r].toLowerCase()}`);
    const refused = `${formatNumber(b.rejected)} refused${reasons.length ? ` (${reasons.join(", ")})` : ""}`;
    return `${formatReadout(b.start)}: ${formatNumber(b.accepted)} accepted · ${refused}`;
  }

  return (
    <div className="chart">
      <div className="chart-legend">
        <span className="dot dot-accepted" /> Accepted events (left)
        <span className="dot dot-enforce" /> Refused requests (right)
        <span className="chart-readout">{active ? readout(active) : "Hover a bar for details"}</span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={ariaLabel}>
        {[0, maxAccepted / 2, maxAccepted].map((t, i) => (
          <g key={i}>
            <line className="grid" x1={PAD.left} x2={WIDTH - PAD.right} y1={yLeft(t)} y2={yLeft(t)} />
            <text className="axis" x={PAD.left - 6} y={yLeft(t) + 4} textAnchor="end">
              {Number.isInteger(t) ? formatNumber(t) : ""}
            </text>
          </g>
        ))}
        {[0, maxRejected / 2, maxRejected].map((t, i) => (
          <text key={i} className="axis axis-rejected" x={WIDTH - PAD.right + 6} y={yRight(t) + 4} textAnchor="start">
            {Number.isInteger(t) ? formatNumber(t) : ""}
          </text>
        ))}
        {buckets.map((b, i) => {
          const x = PAD.left + i * slot;
          const acceptedW = slot * 0.7;
          const rejectedW = slot * 0.28;
          return (
            <g key={b.start} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
              <rect className="hit" x={x} y={PAD.top} width={slot} height={PLOT_H} />
              <rect
                className="bar-accepted"
                x={x + (slot - acceptedW) / 2}
                y={yLeft(b.accepted)}
                width={acceptedW}
                height={yLeft(0) - yLeft(b.accepted)}
                rx={2}
              />
              {b.rejected > 0 && (
                <rect
                  className="bar-enforce"
                  x={x + (slot - rejectedW) / 2}
                  y={yRight(b.rejected)}
                  width={rejectedW}
                  height={yRight(0) - yRight(b.rejected)}
                  rx={1.5}
                />
              )}
              {i % tickEvery === 0 && (
                <text className="axis" x={x + slot / 2} y={HEIGHT - 6} textAnchor="middle">
                  {formatTick(b.start)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
