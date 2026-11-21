/*
  In-memory token bucket, one bucket per key.

  Each bucket holds up to `capacity` tokens and refills continuously at `refillPerSecond`.
  A request spends one token; with none left it is refused and told when to retry.
  State lives in this process, so limits are per API instance (fine for a single VM).
*/

export interface TakeResult {
  ok: boolean;
  retryAfterSeconds: number;
}

export interface TokenBucket {
  take(key: string): TakeResult;
}

export interface TokenBucketOptions {
  capacity: number;
  refillPerSecond: number;
  now?: () => number; // ms; injectable for tests
}

export function createTokenBucket({ capacity, refillPerSecond, now = Date.now }: TokenBucketOptions): TokenBucket {
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();

  return {
    take(key) {
      const t = now();
      const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: t };
      const elapsedSeconds = (t - bucket.updatedAt) / 1000;
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refillPerSecond);
      bucket.updatedAt = t;
      buckets.set(key, bucket);

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { ok: true, retryAfterSeconds: 0 };
      }
      return { ok: false, retryAfterSeconds: Math.ceil((1 - bucket.tokens) / refillPerSecond) };
    },
  };
}
