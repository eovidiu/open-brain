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

// retryAfter is only meaningful when the request is refused, so it is carried
// by that variant alone rather than being optional on both.
export type RateLimitVerdict =
  | { allowed: true }
  | { allowed: false; retryAfter: number };

export class RateLimiter {
  private entries = new Map<string, RateLimitEntry>();
  private windowMs: number;
  private maxRequests: number;

  constructor(config: { windowMs: number; maxRequests: number }) {
    this.windowMs = config.windowMs;
    this.maxRequests = config.maxRequests;
  }

  // Reports the current verdict without spending budget. Callers that only
  // want to charge failures (the MCP auth gate) check this first, then
  // record() on the failure path, so a successful request costs nothing.
  blocked(key: string): RateLimitVerdict {
    const now = Date.now();
    const entry = this.sweep(key, now);

    if (entry.timestamps.length >= this.maxRequests) {
      const oldest = entry.timestamps[0]!;
      const retryAfter = Math.ceil((oldest + this.windowMs - now) / 1000);
      return { allowed: false, retryAfter: Math.max(1, retryAfter) };
    }

    return { allowed: true };
  }

  record(key: string): void {
    const now = Date.now();
    this.sweep(key, now).timestamps.push(now);
  }

  check(key: string): RateLimitVerdict {
    const verdict = this.blocked(key);
    if (verdict.allowed) this.record(key);
    return verdict;
  }

  private sweep(key: string, now: number): RateLimitEntry {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.entries.set(key, entry);
    }
    entry.timestamps = entry.timestamps.filter((t) => t > now - this.windowMs);
    return entry;
  }
}

export function createCaptureRateLimiter(): RateLimiter {
  return new RateLimiter({ windowMs: 60_000, maxRequests: 60 });
}

export function createAuthRateLimiter(): RateLimiter {
  return new RateLimiter({ windowMs: 15 * 60_000, maxRequests: 5 });
}
