import { checkRateLimit, resetRateLimit } from './rate-limit.js';

beforeEach(() => {
  resetRateLimit();
});

describe('checkRateLimit', () => {
  it('allows the first request for a new identifier', () => {
    expect(checkRateLimit('cred-a')).toEqual({ allowed: true, retryAfter: 0 });
  });

  it('allows up to the max requests within the window', () => {
    for (let i = 0; i < 60; i++) {
      expect(checkRateLimit('cred-b').allowed).toBe(true);
    }
  });

  it('blocks the request after the max is exceeded', () => {
    for (let i = 0; i < 60; i++) checkRateLimit('cred-c');
    const result = checkRateLimit('cred-c');
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('tracks separate buckets per identifier', () => {
    for (let i = 0; i < 60; i++) checkRateLimit('cred-d');
    expect(checkRateLimit('cred-d').allowed).toBe(false);
    expect(checkRateLimit('cred-e').allowed).toBe(true);
  });

  it('resets the window after it elapses', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000_000);
    for (let i = 0; i < 60; i++) checkRateLimit('cred-f');
    expect(checkRateLimit('cred-f').allowed).toBe(false);

    nowSpy.mockReturnValue(1_000_000 + 60_001);
    expect(checkRateLimit('cred-f')).toEqual({ allowed: true, retryAfter: 0 });
    nowSpy.mockRestore();
  });
});
