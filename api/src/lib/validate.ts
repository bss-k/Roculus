import type { z } from "zod";
import { schemaRejection } from "./rejection.js";

// Parses with a Zod schema or throws an invalid_schema Rejection.
export function validate<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw schemaRejection(result.error);
  return result.data;
}
