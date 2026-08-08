import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Db } from './index.js';
import {
  API_KEY_PREFIX,
  authenticateApiKey,
  createApiKey,
  generateApiKey,
  hashApiKey,
  listApiKeys,
  revokeApiKey,
  timingSafeEqual,
  touchApiKey,
} from './api-keys.js';

// Cross-implementation hashing pin. The Worker hashes with WebCrypto and the
// CLI with node:crypto; cli/src/commands/keys.test.ts asserts the same two
// constants, so a divergence fails a test instead of silently breaking
// authentication for every issued key. Neither value is a credential.
const PINNED_VECTOR_INPUT = 'obk_pinned-vector-do-not-use-as-a-real-credential';
const PINNED_VECTOR_DIGEST = '742a7a929ab2b40de6c6e39d401855bb31baae2f9bd9c6b4d5c3dc047956b7b8';

function sqlText(mock: ReturnType<typeof vi.fn>, callIndex = 0): string {
  const call = mock.mock.calls[callIndex];
  return (call[0] as readonly string[]).join('?');
}

function sqlParams(mock: ReturnType<typeof vi.fn>, callIndex = 0): unknown[] {
  return mock.mock.calls[callIndex].slice(1);
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'key-1',
    label: 'laptop',
    key_hash: PINNED_VECTOR_DIGEST,
    created_at: new Date('2026-08-08T00:00:00.000Z'),
    last_used_at: null,
    revoked_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('generateApiKey', () => {
  it('produces a prefixed key with 32 bytes of base64url entropy', () => {
    const key = generateApiKey();

    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    const body = key.slice(API_KEY_PREFIX.length);
    // 32 bytes base64url-encoded, unpadded
    expect(body).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('never repeats a key', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateApiKey()));
    expect(keys.size).toBe(100);
  });
});

describe('hashApiKey', () => {
  // Pinned so the CLI's node:crypto implementation and this WebCrypto one can
  // never silently diverge — cli/src/commands/keys.test.ts asserts the same
  // constant. A drift here breaks authentication for every issued key.
  it('matches the pinned cross-implementation vector', async () => {
    expect(await hashApiKey(PINNED_VECTOR_INPUT)).toBe(PINNED_VECTOR_DIGEST);
  });

  it('returns lowercase hex of exactly 64 characters', async () => {
    expect(await hashApiKey(generateApiKey())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', async () => {
    const key = generateApiKey();
    expect(await hashApiKey(key)).toBe(await hashApiKey(key));
  });

  it('gives different hashes for different keys', async () => {
    expect(await hashApiKey(generateApiKey())).not.toBe(await hashApiKey(generateApiKey()));
  });
});

describe('timingSafeEqual', () => {
  it('is true for identical strings', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
  });

  it('is false for different strings of equal length', () => {
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false);
  });

  it('is false for different lengths', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('createApiKey', () => {
  it('inserts the hash and returns the raw key exactly once', async () => {
    const mockSql = vi.fn().mockResolvedValue([row({ label: 'laptop' })]);
    const sql = mockSql as unknown as Db;

    const result = await createApiKey(sql, 'laptop');

    expect(sqlText(mockSql)).toContain('INSERT INTO api_keys');
    const params = sqlParams(mockSql);
    expect(params[0]).toBe('laptop');
    // the hash is stored, never the raw key
    expect(params[1]).toBe(await hashApiKey(result.key));
    expect(params).not.toContain(result.key);

    expect(result.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(result.record).toEqual({
      id: 'key-1',
      label: 'laptop',
      created_at: '2026-08-08T00:00:00.000Z',
      last_used_at: null,
      revoked_at: null,
    });
  });

  it('does not expose the hash on the returned record', async () => {
    const mockSql = vi.fn().mockResolvedValue([row()]);
    const result = await createApiKey(mockSql as unknown as Db, 'laptop');

    expect(result.record).not.toHaveProperty('key_hash');
  });

  it('rejects a duplicate label with a message that carries no key material', async () => {
    const mockSql = vi.fn().mockRejectedValue(new Error('duplicate key value violates unique constraint'));

    await expect(createApiKey(mockSql as unknown as Db, 'laptop')).rejects.toThrow(
      'Database operation failed: create api key',
    );
  });
});

describe('listApiKeys', () => {
  it('selects no key material and normalizes timestamps', async () => {
    const mockSql = vi.fn().mockResolvedValue([
      row({
        last_used_at: new Date('2026-08-08T10:00:00.000Z'),
        revoked_at: new Date('2026-08-08T11:00:00.000Z'),
      }),
    ]);

    const keys = await listApiKeys(mockSql as unknown as Db);

    const text = sqlText(mockSql);
    expect(text).not.toContain('key_hash');
    expect(keys).toEqual([
      {
        id: 'key-1',
        label: 'laptop',
        created_at: '2026-08-08T00:00:00.000Z',
        last_used_at: '2026-08-08T10:00:00.000Z',
        revoked_at: '2026-08-08T11:00:00.000Z',
      },
    ]);
  });

  it('returns an empty list when no keys exist', async () => {
    const mockSql = vi.fn().mockResolvedValue([]);
    expect(await listApiKeys(mockSql as unknown as Db)).toEqual([]);
  });
});

describe('revokeApiKey', () => {
  it('stamps revoked_at for a live key', async () => {
    const revoked = new Date('2026-08-08T12:00:00.000Z');
    const mockSql = vi.fn().mockResolvedValue([row({ revoked_at: revoked })]);

    const record = await revokeApiKey(mockSql as unknown as Db, 'laptop');

    expect(sqlText(mockSql)).toContain('UPDATE api_keys');
    expect(sqlParams(mockSql)).toEqual(['laptop']);
    expect(record.revoked_at).toBe('2026-08-08T12:00:00.000Z');
  });

  it('throws when the label does not exist or is already revoked', async () => {
    const mockSql = vi.fn().mockResolvedValue([]);

    await expect(revokeApiKey(mockSql as unknown as Db, 'ghost')).rejects.toThrow(
      'No active API key with label: ghost',
    );
  });
});

describe('authenticateApiKey', () => {
  it('resolves the record for a live key', async () => {
    const mockSql = vi.fn().mockResolvedValue([row()]);

    const record = await authenticateApiKey(mockSql as unknown as Db, PINNED_VECTOR_INPUT);

    expect(sqlParams(mockSql)).toEqual([PINNED_VECTOR_DIGEST]);
    expect(record?.label).toBe('laptop');
  });

  it('looks the key up by hash, never by the raw key', async () => {
    const mockSql = vi.fn().mockResolvedValue([row()]);

    await authenticateApiKey(mockSql as unknown as Db, PINNED_VECTOR_INPUT);

    expect(sqlParams(mockSql)).not.toContain(PINNED_VECTOR_INPUT);
  });

  it('returns null for an unknown key', async () => {
    const mockSql = vi.fn().mockResolvedValue([]);
    expect(await authenticateApiKey(mockSql as unknown as Db, generateApiKey())).toBeNull();
  });

  it('returns null for a revoked key', async () => {
    const mockSql = vi.fn().mockResolvedValue([
      row({ revoked_at: new Date('2026-08-08T11:00:00.000Z') }),
    ]);

    expect(await authenticateApiKey(mockSql as unknown as Db, PINNED_VECTOR_INPUT)).toBeNull();
  });

  it('returns null when the stored hash does not match the presented key', async () => {
    // Defence in depth: the row is only trusted after a constant-time compare.
    const mockSql = vi.fn().mockResolvedValue([row({ key_hash: 'f'.repeat(64) })]);

    expect(await authenticateApiKey(mockSql as unknown as Db, PINNED_VECTOR_INPUT)).toBeNull();
  });

  it('returns null for an empty key without querying', async () => {
    const mockSql = vi.fn().mockResolvedValue([]);

    expect(await authenticateApiKey(mockSql as unknown as Db, '')).toBeNull();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('never puts the raw key into a database error', async () => {
    const mockSql = vi.fn().mockRejectedValue(new Error(`boom ${PINNED_VECTOR_INPUT}`));

    await expect(
      authenticateApiKey(mockSql as unknown as Db, PINNED_VECTOR_INPUT),
    ).rejects.toThrow('Database operation failed: authenticate api key');
  });
});

describe('touchApiKey', () => {
  it('updates last_used_at by id', async () => {
    const mockSql = vi.fn().mockResolvedValue([]);

    await touchApiKey(mockSql as unknown as Db, 'key-1');

    expect(sqlText(mockSql)).toContain('last_used_at');
    expect(sqlParams(mockSql)).toEqual(['key-1']);
  });
});
