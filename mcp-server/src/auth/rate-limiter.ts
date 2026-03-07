interface RateLimitEntry {
  timestamps: number[];
}

export class RateLimiter {
  private entries = new Map<string, RateLimitEntry>();
  private windowMs: number;
  private maxRequests: number;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(config: { windowMs: number; maxRequests: number }) {
    this.windowMs = config.windowMs;
    this.maxRequests = config.maxRequests;

    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    this.cleanupInterval.unref();
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

  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    for (const [key, entry] of this.entries) {
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) {
        this.entries.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}

export function createCaptureRateLimiter(): RateLimiter {
  return new RateLimiter({ windowMs: 60_000, maxRequests: 60 });
}

export function createAuthRateLimiter(): RateLimiter {
  return new RateLimiter({ windowMs: 15 * 60_000, maxRequests: 5 });
}
