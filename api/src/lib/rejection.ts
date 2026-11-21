import type { ZodError } from "zod";

export type RejectReason = "bad_key" | "invalid_schema" | "rate_limited" | "too_large";

// Thrown anywhere in the request lifecycle; the error handler logs and answers it.
export class Rejection extends Error {
  constructor(
    readonly reason: RejectReason,
    readonly statusCode: number,
    message: string,
    readonly detail?: unknown,
    readonly headers: Record<string, string> = {},
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
