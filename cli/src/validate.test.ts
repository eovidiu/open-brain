import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql, mockNeon } = vi.hoisted(() => {
  const mockSql = vi.fn();
  return { mockSql, mockNeon: vi.fn(() => mockSql) };
});

vi.mock('@neondatabase/serverless', () => ({ neon: mockNeon }));

import { validateNeon } from './validate.js';

describe('validateNeon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok when SELECT 1 succeeds', async () => {
    mockSql.mockResolvedValueOnce([{ '?column?': 1 }]);
    const result = await validateNeon('postgresql://user:pw@host.neon.tech/db');
    expect(result.ok).toBe(true);
    expect(mockNeon).toHaveBeenCalledWith('postgresql://user:pw@host.neon.tech/db');
  });

  it('returns error when the query fails', async () => {
    mockSql.mockRejectedValueOnce(new Error('password authentication failed'));
    const result = await validateNeon('postgresql://user:pw@host.neon.tech/db');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('password authentication failed');
  });

  it('redacts connection-string credentials from error messages', async () => {
    mockSql.mockRejectedValueOnce(
      new Error('cannot connect to postgresql://user:s3cretpw@host.neon.tech/db')
    );
    const result = await validateNeon('postgresql://user:s3cretpw@host.neon.tech/db');
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain('s3cretpw');
  });

  it('returns error when the driver constructor throws (malformed URL)', async () => {
    mockNeon.mockImplementationOnce(() => {
      throw new Error('invalid connection string');
    });
    const result = await validateNeon('not-a-url');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('invalid connection string');
  });
});

describe('LLM key validators', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('validateOpenAIKey ok on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { validateOpenAIKey } = await import('./validate.js');
    expect((await validateOpenAIKey('sk-x')).ok).toBe(true);
  });

  it('validateOpenAIKey redacts keys in error bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'invalid key sk-abcdefghijklmnopqrstuvwx',
      })
    );
    const { validateOpenAIKey } = await import('./validate.js');
    const result = await validateOpenAIKey('sk-x');
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain('sk-abcdefghijklmnopqrstuvwx');
  });

  it('validateAnthropicKey ok on 200 and error on network failure', async () => {
    const { validateAnthropicKey } = await import('./validate.js');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    expect((await validateAnthropicKey('sk-a')).ok).toBe(true);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const failed = await validateAnthropicKey('sk-a');
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain('ECONNRESET');
  });

  it('validateAnthropicKey reports non-ok status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'no',
      })
    );
    const { validateAnthropicKey } = await import('./validate.js');
    const result = await validateAnthropicKey('sk-a');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('403');
  });
});
