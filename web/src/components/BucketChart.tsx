/*
  Stacked bar chart, hand-drawn in SVG: one bar per time bucket, enforce (red) on the bottom and
  shadow (amber) on top. Hover a bar to see its exact counts. Works for any number of buckets
  (Overview's 24 hours, or the 12 / 24 / 28 bars of the 1h / 24h / 7d windows).
*/
import { useId, useState } from "react";
import type { Bucket } from "../api/client";
import { formatNumber } from "../lib/format";

const WIDTH = 720;
const HEIGHT = 220;
const PAD = { top: 12, right: 8, bottom: 24, left: 36 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

// A rounded axis max (1, 2, 5 x 10^n) so gridlines land on readable numbers.
export function niceMax(value: number): number {
  if (value <= 0) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((s) => s * magnitude >= value)!;
  return step * magnitude;
}

export interface BucketChartProps {
  buckets: Bucket[];
  tickEvery: number; // label every Nth bar
  formatTick: (start: string) => string;
  formatReadout: (start: string) => string;
  ariaLabel: string;
}

export function BucketChart({ buckets, tickEvery, formatTick, formatReadout, ariaLabel }: BucketChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const hatchId = useId();
  const max = niceMax(Math.max(...buckets.map((b) => b.shadow + b.enforce)));
  const slot = PLOT_W / buckets.length;
  const barW = slot * 0.7;
  const y = (v: number) => PAD.top + PLOT_H - (v / max) * PLOT_H;
  // A middle gridline only where it lands on a whole number (no "2.5 violations").
  const ticks = Number.isInteger(max / 2) ? [0, max / 2, max] : [0, max];
  const active = hovered === null ? null : buckets[hovered];

  return (
    <div className={hovered === null ? "chart" : "chart is-hovering"}>
      <div className="chart-legend">
        <span className="dot dot-enforce" /> Blocked
        <span className="dot dot-shadow" /> Logged only
        <span className="chart-readout">
          {active
            ? `${formatReadout(active.start)}: ${formatNumber(active.enforce)} enforce, ${formatNumber(active.shadow)} shadow`
            : "Hover a bar for details"}
        </span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={ariaLabel}>
        <defs>
          {/* Hatching = "logged only": the call still ran. Solid = "dropped". */}
          <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="var(--amber)" fillOpacity="0.16" />
            <rect width="2" height="5" fill="var(--amber)" />
          </pattern>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.left} x2={WIDTH - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="axis" x={PAD.left - 6} y={y(t) + 4} textAnchor="end">
              {formatNumber(t)}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const enforceTop = y(b.enforce);
          const shadowTop = y(b.enforce + b.shadow);
          return (
            <g key={b.start} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
              <rect className="hit" x={PAD.left + i * slot} y={PAD.top} width={slot} height={PLOT_H} />
              <g className={i === hovered ? "bar-stack is-active" : "bar-stack"} style={{ animationDelay: `${0.25 + i * 0.02}s` }}>
              <rect className="bar-enforce" x={x} y={enforceTop} width={barW} height={y(0) - enforceTop} rx={1} />
              <rect className="bar-shadow" style={{ fill: `url(#${hatchId})` }} x={x} y={shadowTop} width={barW} height={enforceTop - shadowTop} rx={1} />
              </g>
              {i % tickEvery === 0 && (
                <text className="axis" x={x + barW / 2} y={HEIGHT - 6} textAnchor="middle">
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
