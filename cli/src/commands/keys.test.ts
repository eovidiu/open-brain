import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EnvFile } from '../types.js';

const { mockSql, mockNeon } = vi.hoisted(() => {
  const mockSql = vi.fn();
  return { mockSql, mockNeon: vi.fn(() => mockSql) };
});

vi.mock('@neondatabase/serverless', () => ({ neon: mockNeon }));

vi.mock('../ui.js', () => ({
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../env.js')>();
  return { ...actual, loadEnv: vi.fn() };
});

import * as ui from '../ui.js';
import { loadEnv } from '../env.js';
import { API_KEY_PREFIX, generateApiKey, hashApiKey, runKeys } from './keys.js';

// Same two constants as workers/shared/src/api-keys.test.ts. The Worker hashes
// with WebCrypto and this CLI with node:crypto; pinning one vector in both
// suites makes a divergence a test failure instead of a silent auth outage.
// Neither value is a credential.
const PINNED_VECTOR_INPUT = 'obk_pinned-vector-do-not-use-as-a-real-credential';
const PINNED_VECTOR_DIGEST = '742a7a929ab2b40de6c6e39d401855bb31baae2f9bd9c6b4d5c3dc047956b7b8';

function envWith(values: Record<string, string>): EnvFile {
  return { values, filePath: '/tmp/.env' };
}

function allOutput(): string {
  return [ui.info, ui.success, ui.warn, ui.error]
    .flatMap((fn) => vi.mocked(fn).mock.calls.flat())
    .join(' ');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadEnv).mockReturnValue(envWith({ DATABASE_URL: 'postgresql://localhost/db' }));
});

describe('hashApiKey', () => {
  it('matches the pinned cross-implementation vector', () => {
    expect(hashApiKey(PINNED_VECTOR_INPUT)).toBe(PINNED_VECTOR_DIGEST);
  });

  it('returns lowercase hex of exactly 64 characters', () => {
    expect(hashApiKey(generateApiKey())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('generateApiKey', () => {
  it('produces a prefixed key with 32 bytes of base64url entropy', () => {
    const key = generateApiKey();

    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key.slice(API_KEY_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('never repeats a key', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateApiKey()));
    expect(keys.size).toBe(100);
  });
});

describe('runKeys create', () => {
  it('stores the hash and prints the raw key exactly once', async () => {
    mockSql.mockResolvedValue([
      { id: 'k1', label: 'laptop', created_at: new Date('2026-08-08T00:00:00.000Z') },
    ]);

    await runKeys(['create', 'laptop']);

    const params = mockSql.mock.calls[0].slice(1);
    expect(params[0]).toBe('laptop');
    expect(params[1]).toMatch(/^[0-9a-f]{64}$/);

    const printed = allOutput();
    const matches = printed.match(new RegExp(`${API_KEY_PREFIX}[A-Za-z0-9_-]{43}`, 'g')) ?? [];
    expect(matches).toHaveLength(1);

    // what went to the database is the hash of what was printed
    expect(params[1]).toBe(hashApiKey(matches[0]!));
  });

  it('warns that the key cannot be retrieved later', async () => {
    mockSql.mockResolvedValue([
      { id: 'k1', label: 'laptop', created_at: new Date('2026-08-08T00:00:00.000Z') },
    ]);

    await runKeys(['create', 'laptop']);

    expect(vi.mocked(ui.warn).mock.calls.flat().join(' ')).toMatch(/not be shown again/i);
  });

  it('rejects a missing label', async () => {
    await expect(runKeys(['create'])).rejects.toThrow(/label/i);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('reports a duplicate label without printing a key', async () => {
    mockSql.mockRejectedValue(new Error('duplicate key value violates unique constraint "api_keys_label_key"'));

    await expect(runKeys(['create', 'laptop'])).rejects.toThrow(/already exists/i);
    expect(allOutput()).not.toContain(API_KEY_PREFIX);
  });

  it('keeps the raw key out of an unexpected database error', async () => {
    mockSql.mockRejectedValue(new Error('connection refused'));

    await expect(runKeys(['create', 'laptop'])).rejects.toThrow();
    expect(allOutput()).not.toContain(API_KEY_PREFIX);
  });

  it('handles a driver that rejects with a non-Error', async () => {
    mockSql.mockRejectedValue('socket hang up');

    await expect(runKeys(['create', 'laptop'])).rejects.toThrow(/Could not create/);
    expect(allOutput()).not.toContain(API_KEY_PREFIX);
  });
});

describe('runKeys list', () => {
  it('selects no key material', async () => {
    mockSql.mockResolvedValue([]);

    await runKeys(['list']);

    const text = (mockSql.mock.calls[0][0] as readonly string[]).join('?');
    expect(text).not.toContain('key_hash');
  });

  it('prints label, created, last used and status but never a key or hash', async () => {
    mockSql.mockResolvedValue([
      {
        id: 'k1',
        label: 'laptop',
        key_hash: PINNED_VECTOR_DIGEST,
        created_at: new Date('2026-08-08T00:00:00.000Z'),
        last_used_at: new Date('2026-08-08T10:00:00.000Z'),
        revoked_at: null,
      },
    ]);

    await runKeys(['list']);

    const printed = allOutput();
    expect(printed).toContain('laptop');
    expect(printed).toContain('2026-08-08');
    expect(printed).not.toContain(PINNED_VECTOR_DIGEST);
    expect(printed).not.toContain(API_KEY_PREFIX);
  });

  it('marks a revoked key as revoked and a never-used key as never', async () => {
    mockSql.mockResolvedValue([
      {
        id: 'k1',
        label: 'old',
        created_at: new Date('2026-08-01T00:00:00.000Z'),
        last_used_at: null,
        revoked_at: new Date('2026-08-05T00:00:00.000Z'),
      },
    ]);

    await runKeys(['list']);

    const printed = allOutput();
    expect(printed).toMatch(/revoked/i);
    expect(printed).toMatch(/never/i);
  });

  it('reports an empty list plainly', async () => {
    mockSql.mockResolvedValue([]);

    await runKeys(['list']);

    expect(allOutput()).toMatch(/no api keys/i);
  });
});

describe('runKeys revoke', () => {
  it('stamps revoked_at for the label', async () => {
    mockSql.mockResolvedValue([{ id: 'k1', label: 'laptop', revoked_at: new Date() }]);

    await runKeys(['revoke', 'laptop']);

    const text = (mockSql.mock.calls[0][0] as readonly string[]).join('?');
    expect(text).toContain('UPDATE api_keys');
    expect(mockSql.mock.calls[0].slice(1)).toEqual(['laptop']);
    expect(allOutput()).toContain('laptop');
  });

  it('rejects a missing label', async () => {
    await expect(runKeys(['revoke'])).rejects.toThrow(/label/i);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('fails when the label is unknown or already revoked', async () => {
    mockSql.mockResolvedValue([]);

    await expect(runKeys(['revoke', 'ghost'])).rejects.toThrow(/no active api key/i);
  });
});

describe('runKeys preconditions', () => {
  it('fails when DATABASE_URL is in neither .env nor the environment', async () => {
    vi.mocked(loadEnv).mockReturnValue(envWith({}));
    vi.stubEnv('DATABASE_URL', '');

    await expect(runKeys(['list'])).rejects.toThrow(/DATABASE_URL/);
    expect(mockNeon).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
  });

  it('falls back to DATABASE_URL from the environment when .env lacks it', async () => {
    vi.mocked(loadEnv).mockReturnValue(envWith({}));
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost/from-env');
    mockSql.mockResolvedValue([]);

    await runKeys(['list']);

    expect(mockNeon).toHaveBeenCalledWith('postgresql://localhost/from-env');

    vi.unstubAllEnvs();
  });

  // An inline DATABASE_URL= is an explicit override. A stale .env shadowing it
  // authenticates against the wrong credential and surfaces as "password
  // authentication failed", which looks identical to a wrong password.
  it('prefers the environment over a stale .env', async () => {
    vi.mocked(loadEnv).mockReturnValue(envWith({ DATABASE_URL: 'postgresql://localhost/stale-dotenv' }));
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost/explicit-override');
    mockSql.mockResolvedValue([]);

    await runKeys(['list']);

    expect(mockNeon).toHaveBeenCalledWith('postgresql://localhost/explicit-override');

    vi.unstubAllEnvs();
  });

  it('uses .env when the environment does not set DATABASE_URL', async () => {
    vi.mocked(loadEnv).mockReturnValue(envWith({ DATABASE_URL: 'postgresql://localhost/from-dotenv' }));
    vi.stubEnv('DATABASE_URL', '');
    mockSql.mockResolvedValue([]);

    await runKeys(['list']);

    expect(mockNeon).toHaveBeenCalledWith('postgresql://localhost/from-dotenv');

    vi.unstubAllEnvs();
  });

  it('rejects an unknown subcommand', async () => {
    await expect(runKeys(['frobnicate'])).rejects.toThrow(/usage/i);
  });

  it('rejects a missing subcommand', async () => {
    await expect(runKeys([])).rejects.toThrow(/usage/i);
  });
});
