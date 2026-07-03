import type { MemoryMetadata } from './types.js';

const { mockNeon } = vi.hoisted(() => ({ mockNeon: vi.fn() }));

vi.mock('@neondatabase/serverless', () => ({ neon: mockNeon }));

import {
  createDb,
  getRetryEligibleMemories,
  incrementEmbeddingRetry,
  incrementMetadataRetry,
  insertMemory,
  parseVector,
  toIso,
  updateMemoryEmbedding,
  updateMemoryMetadata,
} from './index.js';

const METADATA: MemoryMetadata = {
  type: 'insight',
  topics: ['workers'],
  people: [],
  action_items: [],
  confidence: 0.8,
  truncated: false,
};

const VECTOR = [0.1, 0.2, 0.3];

const mockSql = vi.fn() as ReturnType<typeof vi.fn> &
  Parameters<typeof insertMemory>[0];

function sqlText(callIndex = 0): string {
  const call = mockSql.mock.calls[callIndex];
  return (call[0] as readonly string[]).join('?');
}

function sqlParams(callIndex = 0): unknown[] {
  return mockSql.mock.calls[callIndex].slice(1);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('createDb', () => {
  it('creates a connection from the given url', () => {
    mockNeon.mockReturnValue(mockSql);

    const db = createDb('postgres://worker:pw@host/db');

    expect(mockNeon).toHaveBeenCalledWith('postgres://worker:pw@host/db');
    expect(db).toBe(mockSql);
  });

  it('rejects an empty url', () => {
    expect(() => createDb('')).toThrow('database url is required');
  });
});

describe('helpers', () => {
  it('toIso normalizes Date and string to ISO', () => {
    expect(toIso(new Date('2026-07-03T10:00:00.000Z'))).toBe(
      '2026-07-03T10:00:00.000Z',
    );
    expect(toIso('2026-07-03T10:00:00.000Z')).toBe('2026-07-03T10:00:00.000Z');
  });

  it('parseVector parses text form and passes null through', () => {
    expect(parseVector('[0.1,0.2]')).toEqual([0.1, 0.2]);
    expect(parseVector(null)).toBeNull();
    expect(parseVector([0.3])).toEqual([0.3]);
  });
});

describe('insertMemory', () => {
  const RECORD = {
    id: 'mem-1',
    raw_text: 'hello from a worker',
    embedding: VECTOR,
    embedding_status: 'ready' as const,
    metadata: METADATA,
    metadata_status: 'ready' as const,
    captured_at: '2026-07-03T10:00:00.000Z',
    source: 'api' as const,
  };

  it('inserts and maps the returned row', async () => {
    mockSql.mockResolvedValue([
      {
        id: 'mem-1',
        captured_at: new Date('2026-07-03T10:00:00.000Z'),
        source: 'api',
        embedding_status: 'ready',
        metadata_status: 'ready',
        metadata: METADATA,
      },
    ]);

    const result = await insertMemory(mockSql, RECORD);

    expect(sqlText()).toContain('INSERT INTO memories');
    expect(sqlParams()).toContain(JSON.stringify(VECTOR));
    expect(result.id).toBe('mem-1');
    expect(result.captured_at).toBe('2026-07-03T10:00:00.000Z');
  });

  it('passes null embedding through', async () => {
    mockSql.mockResolvedValue([
      {
        id: 'mem-1',
        captured_at: '2026-07-03T10:00:00.000Z',
        source: 'api',
        embedding_status: 'pending',
        metadata_status: 'degraded',
        metadata: {},
      },
    ]);

    await insertMemory(mockSql, {
      ...RECORD,
      embedding: null,
      embedding_status: 'pending',
      metadata_status: 'degraded',
    });

    expect(sqlParams()).toContain(null);
  });

  it('sanitizes database errors', async () => {
    mockSql.mockRejectedValue(new Error('connection refused'));

    await expect(insertMemory(mockSql, RECORD)).rejects.toThrow(
      'Database operation failed: insert memory',
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('connection refused'),
    );
  });
});

describe('getRetryEligibleMemories', () => {
  it('calls the SQL function with the batch limit', async () => {
    const row = {
      id: 'mem-1',
      embedding_status: 'pending',
      metadata_status: 'ready',
      retry_count_embedding: 2,
      retry_count_metadata: 0,
      captured_at: new Date('2026-07-01T00:00:00.000Z'),
      raw_text: 'retry me',
    };
    mockSql.mockResolvedValue([row]);

    const eligible = await getRetryEligibleMemories(mockSql, 20);

    expect(sqlText()).toContain('get_retry_eligible_memories');
    expect(sqlParams()).toEqual([20]);
    expect(eligible).toEqual([
      { ...row, captured_at: '2026-07-01T00:00:00.000Z' },
    ]);
  });

  it('sanitizes database errors', async () => {
    mockSql.mockRejectedValue(new Error('boom'));

    await expect(getRetryEligibleMemories(mockSql, 20)).rejects.toThrow(
      'Database operation failed: get retry eligible memories',
    );
  });
});

describe('updateMemoryEmbedding', () => {
  it('sets the embedding and marks ready', async () => {
    mockSql.mockResolvedValue([]);

    await updateMemoryEmbedding(mockSql, 'mem-1', VECTOR);

    expect(sqlText()).toContain('UPDATE memories');
    expect(sqlParams()).toContain(JSON.stringify(VECTOR));
    expect(sqlParams()).toContain('mem-1');
  });

  it('sanitizes database errors', async () => {
    mockSql.mockRejectedValue(new Error('boom'));

    await expect(updateMemoryEmbedding(mockSql, 'mem-1', VECTOR)).rejects.toThrow(
      'Database operation failed: update embedding',
    );
  });
});

describe('updateMemoryMetadata', () => {
  it('sets the metadata and marks ready', async () => {
    mockSql.mockResolvedValue([]);

    await updateMemoryMetadata(mockSql, 'mem-1', METADATA);

    expect(sqlText()).toContain('UPDATE memories');
    expect(sqlParams()).toContain(JSON.stringify(METADATA));
  });

  it('sanitizes database errors', async () => {
    mockSql.mockRejectedValue(new Error('boom'));

    await expect(updateMemoryMetadata(mockSql, 'mem-1', METADATA)).rejects.toThrow(
      'Database operation failed: update metadata',
    );
  });
});

describe('retry increments', () => {
  it('incrementEmbeddingRetry is one atomic statement', async () => {
    mockSql.mockResolvedValue([]);

    await incrementEmbeddingRetry(mockSql, 'mem-1', 'OpenAI timeout');

    expect(mockSql).toHaveBeenCalledTimes(1);
    expect(sqlText()).toContain('retry_count_embedding + 1');
    expect(sqlText()).toContain('CASE');
    expect(sqlParams()).toContain('OpenAI timeout');
  });

  it('incrementMetadataRetry is one atomic statement', async () => {
    mockSql.mockResolvedValue([]);

    await incrementMetadataRetry(mockSql, 'mem-1', 'LLM timeout');

    expect(mockSql).toHaveBeenCalledTimes(1);
    expect(sqlText()).toContain('retry_count_metadata + 1');
    expect(sqlText()).toContain('CASE');
  });

  it('sanitizes database errors on both', async () => {
    mockSql.mockRejectedValue(new Error('boom'));

    await expect(incrementEmbeddingRetry(mockSql, 'mem-1', 'e')).rejects.toThrow(
      'Database operation failed: increment embedding retry',
    );
    await expect(incrementMetadataRetry(mockSql, 'mem-1', 'e')).rejects.toThrow(
      'Database operation failed: increment metadata retry',
    );
  });
});
