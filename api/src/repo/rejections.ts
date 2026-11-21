import type { Db } from "../db/pool.js";
import type { RejectReason } from "../lib/rejection.js";

export interface RejectionRow {
  reason: RejectReason;
  apiKeyId: string | null;
  ip: string | null;
  route: string;
  detail: unknown;
}

export async function insertRejection(db: Db, row: RejectionRow): Promise<void> {
  await db.query(
    "INSERT INTO rejected_requests (reason, api_key_id, ip, route, detail) VALUES ($1, $2, $3, $4, $5)",
    [row.reason, row.apiKeyId, row.ip, row.route, row.detail === undefined ? null : JSON.stringify(row.detail)],
  );
}
