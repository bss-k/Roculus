import { z } from "zod";

const EnvSchema = z.object({
  // Default matches docker-compose.yml so local dev needs no .env file.
  DATABASE_URL: z.string().default("postgres://oculus:oculus@localhost:5432/oculus"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3000),
  TRUST_PROXY: z.stringbool().default(false),
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(128 * 1024),
  // Token buckets: `burst` requests at once, refilled at `perMinute`.
  INGEST_PER_MINUTE: z.coerce.number().positive().default(60),
  INGEST_BURST: z.coerce.number().int().positive().default(20),
  READ_PER_MINUTE: z.coerce.number().positive().default(240),
  READ_BURST: z.coerce.number().int().positive().default(40),
  // Key management is rare and sensitive: its own, smaller bucket.
  ADMIN_PER_MINUTE: z.coerce.number().positive().default(30),
  ADMIN_BURST: z.coerce.number().int().positive().default(10),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return EnvSchema.parse(env);
}
