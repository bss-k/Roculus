import type { ZodError } from "zod";

// Must match the rejected_requests.reason check in migrations/001_init.sql.
export const REJECT_REASONS = ["bad_key", "invalid_schema", "rate_limited", "too_large"] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

// Thrown anywhere in the request lifecycle; the error handler logs and answers it.
export class Rejection extends Error {
  constructor(
    readonly reason: RejectReason,
    readonly statusCode: number,
    message: string,
    readonly detail?: unknown,
    readonly headers: Record<string, string> = {},
    // The key a refused request used, when it isn't request.auth: a real key that is expired or
    // revoked. Lets the rejection log attribute it to that key's game.
    readonly apiKeyId?: string,
  ) {
    super(message);
  }
}

const MAX_ISSUES = 10;

export function schemaRejection(error: ZodError): Rejection {
  const issues = error.issues.slice(0, MAX_ISSUES).map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  return new Rejection("invalid_schema", 400, "request failed validation", { issues });
}
