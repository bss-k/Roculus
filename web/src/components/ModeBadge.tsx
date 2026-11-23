import type { Mode } from "../api/client";

// kind="result": what happened to one call (Blocked / Logged). kind="mode": a remote's setting.
export function ModeBadge({ mode, kind = "mode" }: { mode: Mode; kind?: "mode" | "result" }) {
  const label = kind === "result" ? (mode === "enforce" ? "Blocked" : "Logged") : mode === "enforce" ? "Enforce" : "Shadow";
  return <span className={`badge badge-${mode}`}>{label}</span>;
}
