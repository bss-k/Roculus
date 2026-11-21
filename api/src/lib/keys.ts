import { createHash, randomBytes } from "node:crypto";

const KEY_PREFIX = "ocl_";

// 32 random bytes = 256 bits of entropy, so a fast hash is enough (nothing to brute-force).
export function generateKey(): string {
  return KEY_PREFIX + randomBytes(32).toString("base64url");
}

export function hashKey(rawKey: string): Buffer {
  return createHash("sha256").update(rawKey).digest();
}

// Short, non-secret label shown in tooling so you can tell keys apart.
export function displayPrefix(rawKey: string): string {
  return rawKey.slice(0, KEY_PREFIX.length + 6);
}

// Extracts the key from "Authorization: Bearer <key>", or null if the header is malformed.
export function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{16,128})$/.exec(header);
  return match?.[1] ?? null;
}
