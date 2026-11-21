/*
  A tiny version of BucketChart for table rows: stacked bars, enforce (red) under shadow (amber),
  no axes. Scaled to its own peak, so it shows the shape of the traffic, not its size.
*/
import type { Bucket } from "../api/client";
import { formatNumber } from "../lib/format";

const WIDTH = 120;
const HEIGHT = 28;

export function Sparkline({ buckets }: { buckets: Bucket[] }) {
  const totals = buckets.map((b) => b.shadow + b.enforce);
  const peak = Math.max(1, ...totals);
  const sum = totals.reduce((n, t) => n + t, 0);
  const slot = WIDTH / buckets.length;
  const barW = Math.max(1, slot - 1);
  const h = (v: number) => (v / peak) * (HEIGHT - 2);

  return (
    <svg
      className="sparkline"
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`${formatNumber(sum)} violations, at most ${formatNumber(Math.max(0, ...totals))} in one bar`}
    >
      <line className="sparkline-base" x1={0} x2={WIDTH} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} />
      {buckets.map((b, i) => {
        const x = i * slot;
        const enforceH = h(b.enforce);
        const shadowH = h(b.shadow);
        return (
          <g key={b.start}>
            <rect className="bar-enforce" x={x} y={HEIGHT - enforceH} width={barW} height={enforceH} />
            <rect className="bar-shadow" x={x} y={HEIGHT - enforceH - shadowH} width={barW} height={shadowH} />
          </g>
        );
      })}
    </svg>
  );
}
