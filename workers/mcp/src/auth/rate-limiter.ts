// In-memory rate limiter. Adapted from mcp-server/src/auth/rate-limiter.ts:
// the periodic setInterval(...).unref() sweep is dropped because Workers'
// setInterval returns a plain number with no .unref(), and a persistent
// background timer isn't reliable in a stateless Worker. Cleanup instead
// happens lazily inside check() (stale timestamps are filtered per key on
// every call). State resets on isolate recycle — same best-effort
// characteristics already accepted by workers/capture's rate-limit.ts.
interface RateLimitEntry {
  timestamps: number[];
}

export class RateLimiter {
  private entries = new Map<string, RateLimitEntry>();
  private windowMs: number;
  private maxRequests: number;

  constructor(config: { windowMs: number; maxRequests: number }) {
    this.windowMs = config.windowMs;
    this.maxRequests = config.maxRequests;
  }

  check(key: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let entry = this.entries.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.entries.set(key, entry);
    }

    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    if (entry.timestamps.length >= this.maxRequests) {
      const oldest = entry.timestamps[0]!;
      const retryAfter = Math.ceil((oldest + this.windowMs - now) / 1000);
      return { allowed: false, retryAfter: Math.max(1, retryAfter) };
    }

    entry.timestamps.push(now);
    return { allowed: true };
  }
}

export function createCaptureRateLimiter(): RateLimiter {
  return new RateLimiter({ windowMs: 60_000, maxRequests: 60 });
}

export function createAuthRateLimiter(): RateLimiter {
  return new RateLimiter({ windowMs: 15 * 60_000, maxRequests: 5 });
}
