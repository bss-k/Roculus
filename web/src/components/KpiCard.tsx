import { formatNumber } from "../lib/format";

interface KpiCardProps {
  label: string;
  value: number | undefined;
  accent: "red" | "amber" | "blue";
  hint?: string;
}

export function KpiCard({ label, value, accent, hint }: KpiCardProps) {
  return (
    <div className={`kpi kpi-${accent}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value === undefined ? "—" : formatNumber(value)}</span>
      {hint && <span className="kpi-hint">{hint}</span>}
    </div>
  );
}
