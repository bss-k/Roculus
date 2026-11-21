import type { Mode } from "../api/client";

export function ModeBadge({ mode }: { mode: Mode }) {
  return <span className={`badge badge-${mode}`}>{mode}</span>;
}
