// In-memory rate limiter, ported from supabase/functions/capture/index.ts.
// State resets on cold start (a new isolate) and is not shared across
// isolates — same best-effort characteristics as the Deno edge function.

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

const rateBuckets = new Map<string, { count: number; windowStart: number }>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfter: number;
}

export function checkRateLimit(identifier: string): RateLimitResult {
  const now = Date.now();
  const bucket = rateBuckets.get(identifier);

  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(identifier, { count: 1, windowStart: now });
    return { allowed: true, retryAfter: 0 };
  }

  if (bucket.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((bucket.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter };
  }

  bucket.count++;
  return { allowed: true, retryAfter: 0 };
}

export function resetRateLimit(): void {
  rateBuckets.clear();
}
