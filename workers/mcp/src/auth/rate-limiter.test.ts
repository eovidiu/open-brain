import { RateLimiter, createCaptureRateLimiter, createAuthRateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  it('allows requests under the limit', () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 3 });

    expect(limiter.check('key').allowed).toBe(true);
    expect(limiter.check('key').allowed).toBe(true);
    expect(limiter.check('key').allowed).toBe(true);
  });

  it('blocks requests over the limit', () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 2 });

    limiter.check('key');
    limiter.check('key');
    const result = limiter.check('key');

    expect(result.allowed).toBe(false);
  });

  it('returns retryAfter when blocked', () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });

    limiter.check('key');
    const result = limiter.check('key');

    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeDefined();
    expect(result.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it('tracks different keys independently', () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });

    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('b').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    expect(limiter.check('b').allowed).toBe(false);
  });

  it('resets after the window expires (lazy cleanup on next check)', async () => {
    const limiter = new RateLimiter({ windowMs: 100, maxRequests: 1 });

    expect(limiter.check('key').allowed).toBe(true);
    expect(limiter.check('key').allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(limiter.check('key').allowed).toBe(true);
  });
});

describe('createCaptureRateLimiter', () => {
  it('creates a limiter with 60 requests per 60s window', () => {
    const limiter = createCaptureRateLimiter();

    for (let i = 0; i < 60; i++) {
      expect(limiter.check('key').allowed).toBe(true);
    }
    expect(limiter.check('key').allowed).toBe(false);
  });
});

describe('createAuthRateLimiter', () => {
  it('creates a limiter with 5 requests per 15min window', () => {
    const limiter = createAuthRateLimiter();

    for (let i = 0; i < 5; i++) {
      expect(limiter.check('key').allowed).toBe(true);
    }
    expect(limiter.check('key').allowed).toBe(false);
  });
});
