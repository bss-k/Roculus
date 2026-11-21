import { describe, expect, it } from "vitest";
import { createTokenBucket } from "../src/lib/tokenBucket.js";

describe("token bucket", () => {
  it("allows a burst, refuses, then refills over time", () => {
    let now = 0;
    const bucket = createTokenBucket({ capacity: 2, refillPerSecond: 1, now: () => now });

    expect(bucket.take("a").ok).toBe(true);
    expect(bucket.take("a").ok).toBe(true);
    expect(bucket.take("a")).toEqual({ ok: false, retryAfterSeconds: 1 });

    now += 1000;
    expect(bucket.take("a").ok).toBe(true);
    expect(bucket.take("a").ok).toBe(false);
  });

  it("never refills past capacity", () => {
    let now = 0;
    const bucket = createTokenBucket({ capacity: 2, refillPerSecond: 1, now: () => now });
    now += 60_000;
    expect([1, 2, 3].map(() => bucket.take("a").ok)).toEqual([true, true, false]);
  });

  it("keeps keys independent", () => {
    const bucket = createTokenBucket({ capacity: 1, refillPerSecond: 1, now: () => 0 });
    expect(bucket.take("a").ok).toBe(true);
    expect(bucket.take("b").ok).toBe(true);
    expect(bucket.take("a").ok).toBe(false);
  });
});
