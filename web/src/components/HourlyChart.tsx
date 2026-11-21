/*
  Overview's chart: the last 24 clock hours, labelled every 3 hours. A thin wrapper so the
  Overview screen renders exactly what it did before BucketChart was generalized.
*/
import type { HourBucket } from "../api/client";
import { formatHour } from "../lib/format";
import { BucketChart } from "./BucketChart";

export function HourlyChart({ hours }: { hours: HourBucket[] }) {
  return (
    <BucketChart
      buckets={hours.map((h) => ({ start: h.hour, shadow: h.shadow, enforce: h.enforce }))}
      tickEvery={3}
      formatTick={formatHour}
      formatReadout={formatHour}
      ariaLabel="Violations per hour, last 24 hours"
    />
  );
}
