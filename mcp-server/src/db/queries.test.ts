import type { MemoryMetadata } from '../types.js';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));

vi.mock('@neondatabase/serverless', () => ({ neon: vi.fn(() => mockSql) }));

import {
  deleteMemory,
  getStats,
  getSystemConfig,
  incrementEmbeddingRetry,
  incrementMetadataRetry,
  insertMemory,
  listRecentMemories,
  searchMemories,
  updateMemoryEmbedding,
  updateMemoryMetadata,
} from './queries.js';

const METADATA: MemoryMetadata = {
  type: 'insight',
  topics: ['testing'],
  people: [],
  action_items: [],
  confidence: 0.9,
  truncated: false,
};

const VECTOR = [0.1, 0.2, 0.3];

function sqlText(callIndex = 0): string {
  const call = mockSql.mock.calls[callIndex];
  return (call[0] as readonly string[]).join('?');
}

function sqlParams(callIndex = 0): unknown[] {
  return mockSql.mock.calls[callIndex].slice(1);
}

beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://unit:test@localhost/unit';
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('insertMemory', () => {
  const RECORD = {
    id: 'mem-1',
    raw_text: 'hello',
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

    const result = await insertMemory(RECORD);

    expect(sqlText()).toContain('INSERT INTO memories');
    expect(sqlParams()).toContain(JSON.stringify(VECTOR));
    expect(result).toEqual({
      id: 'mem-1',
      captured_at: '2026-07-03T10:00:00.000Z',
      source: 'api',
      embedding_status: 'ready',
      metadata_status: 'ready',
      metadata: METADATA,
    });
  });

  it('passes null embedding through unstringified', async () => {
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

    await insertMemory({
      ...RECORD,
      embedding: null,
      embedding_status: 'pending',
      metadata_status: 'degraded',
    });

    expect(sqlParams()).toContain(null);
  });

  it('sanitizes database errors', async () => {
    mockSql.mockRejectedValue(new Error('connection refused to host 10.0.0.5'));

    await expect(insertMemory(RECORD)).rejects.toThrow(
      'Database operation failed: insert memory',
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('connection refused'),
    );
  });
});

describe('searchMemories', () => {
  const ROW = {
    id: 'mem-1',
    raw_text: 'found',
    captured_at: new Date('2026-07-01T00:00:00.000Z'),
    source: 'api',
    metadata: METADATA,
    metadata_status: 'ready',
    embedding_status: 'ready',
    similarity_score: 0.87,
  };

  it('calls search_memories with vector and count', async () => {
    mockSql.mockResolvedValue([ROW]);

    const results = await searchMemories(VECTOR, 5);

    expect(sqlText()).toContain('search_memories');
    expect(sqlParams()).toEqual([JSON.stringify(VECTOR), 5, null, null]);
    expect(results).toEqual([
      { ...ROW, captured_at: '2026-07-01T00:00:00.000Z' },
    ]);
  });

  it('passes filter_type and since when provided', async () => {
    mockSql.mockResolvedValue([]);

    await searchMemories(VECTOR, 10, 'decision', '2026-01-01');

    expect(sqlParams()).toEqual([
      JSON.stringify(VECTOR),
      10,
      'decision',
      '2026-01-01',
    ]);
  });

  it('sanitizes database errors', async () => {
    mockSql.mockRejectedValue(new Error('relation does not exist'));

    await expect(searchMemories(VECTOR, 5)).rejects.toThrow(
      'Database operation failed: search memories',
    );
  });
});

describe('listRecentMemories', () => {
  const ROW = {
    id: 'mem-1',
    raw_text: 'recent',
    embedding: '[0.1,0.2,0.3]',
    embedding_status: 'ready',
    metadata: METADATA,
    metadata_status: 'ready',
    captured_at: new Date('2026-07-02T00:00:00.000Z'),
    source: 'api',
    retry_count_embedding: 0,
    retry_count_metadata: 0,
    last_processing_error: null,
  };

  it('lists without filter and parses the vector column', async () => {
    mockSql.mockResolvedValue([ROW]);

    const memories = await listRecentMemories(10);

    expect(sqlText()).toContain('ORDER BY captured_at DESC');
    expect(memories[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(memories[0].captured_at).toBe('2026-07-02T00:00:00.000Z');
  });

  it('keeps null embedding as null', async () => {
    mockSql.mockResolvedValue([{ ...ROW, embedding: null }]);

    const memories = await listRecentMemories(10);

    expect(memories[0].embedding).toBeNull();
  });

  it('filters by metadata type when provided', async () => {
    mockSql.mockResolvedValue([]);

    await listRecentMemories(5, 'decision');

    expect(sqlText()).toContain("metadata->>'type'");
    expect(sqlParams()).toContain('decision');
  });

  it('sanitizes database errors', async () => {
    mockSql.mockRejectedValue(new Error('boom'));

    await expect(listRecentMemories(10)).rejects.toThrow(
      'Database operation failed: list memories',
    );
  });
});

describe('getStats', () => {
  it('returns the stats json from get_memory_stats', async () => {
    const stats = {
      total_memories: 3,
      last_7_days: 2,
      last_30_days: 3,
      by_type: { insight: 3 },
      by_embedding_status: { ready: 3 },
      embedding_model: 'text-embedding-3-small',
      top_topics: [{ topic: 'testing', count: 2 }],
    };
    mockSql.mockResolvedValue([{ stats }]);

    const result = await getStats();

    expect(sqlText()).toContain('get_memory_stats');
    expect(result).toEqual(stats);
  });

  it('sanitizes database errors', async () => {
    mockSql.mockRejectedValue(new Error('boom'));

    await expect(getStats()).rejects.toThrow(
      'Database operation failed: get stats',
    );
  });
});

describe('getSystemConfig', () => {
  it('returns the singleton row', async () => {
    mockSql.mockResolvedValue([
      {
        id: 1,
        embedding_model: 'text-embedding-3-small',
        embedding_dimensions: 1536,
        created_at: new Date('2026-07-03T00:00:00.000Z'),
        updated_at: new Date('2026-07-03T00:00:00.000Z'),
      },
    ]);

    const config = await getSystemConfig();

    expect(config.embedding_model).toBe('text-embedding-3-small');
    expect(config.created_at).toBe('2026-07-03T00:00:00.000Z');
  });

  it('sanitizes a missing config row', async () => {
    mockSql.mockResolvedValue([]);

    await expect(getSystemConfig()).rejects.toThrow(
      'Database operation failed: read system config',
    );
  });
});

describe('updateMemoryEmbedding', () => {
  it('updates the embedding and marks ready', async () => {
    mockSql.mockResolvedValue([]);

    await updateMemoryEmbedding('mem-1', VECTOR);

    expect(sqlText()).toContain('UPDATE memories');
    expect(sqlText()).toContain('embedding_status');
    expect(sqlParams()).toContain(JSON.stringify(VECTOR));
    expect(sqlParams()).toContain('mem-1');
  });

  it('sanitizes database errors', async () => {
    mockSql.mockRejectedValue(new Error('boom'));

    await expect(updateMemoryEmbedding('mem-1', VECTOR)).rejects.toThrow(
      'Database operation failed: update embedding',
    );
  });
});

describe('updateMemoryMetadata', () => {
  it('updates the metadata and marks ready', async () => {
    mockSql.mockResolvedValue([]);

    await updateMemoryMetadata('mem-1', METADATA);

    expect(sqlText()).toContain('UPDATE memories');
    expect(sqlParams()).toContain(JSON.stringify(METADATA));
    expect(sqlParams()).toContain('mem-1');
  });

  it('sanitizes database errors', async () => {
    mockSql.mockRejectedValue(new Error('boom'));

    await expect(updateMemoryMetadata('mem-1', METADATA)).rejects.toThrow(
      'Database operation failed: update metadata',
    );
  });
});

describe('incrementEmbeddingRetry', () => {
  it('increments atomically in a single statement', async () => {
    mockSql.mockResolvedValue([]);

    await incrementEmbeddingRetry('mem-1', 'OpenAI timeout');

    expect(mockSql).toHaveBeenCalledTimes(1);
    expect(sqlText()).toContain('retry_count_embedding + 1');
    expect(sqlText()).toContain('CASE');
    expect(sqlParams()).toContain('OpenAI timeout');
    expect(sqlParams()).toContain('mem-1');
  });

  it('sanitizes database errors', async () => {
    mockSql.mockRejectedValue(new Error('boom'));

    await expect(incrementEmbeddingRetry('mem-1', 'err')).rejects.toThrow(
      'Database operation failed: increment embedding retry',
    );
  });
});

describe('incrementMetadataRetry', () => {
  it('increments atomically in a single statement', async () => {
    mockSql.mockResolvedValue([]);

    await incrementMetadataRetry('mem-1', 'LLM timeout');

    expect(mockSql).toHaveBeenCalledTimes(1);
    expect(sqlText()).toContain('retry_count_metadata + 1');
    expect(sqlText()).toContain('CASE');
    expect(sqlParams()).toContain('LLM timeout');
    expect(sqlParams()).toContain('mem-1');
  });

  it('sanitizes database errors', async () => {
    mockSql.mockRejectedValue(new Error('boom'));

    await expect(incrementMetadataRetry('mem-1', 'err')).rejects.toThrow(
      'Database operation failed: increment metadata retry',
    );
  });
});

describe('deleteMemory', () => {
  it('deletes by id and returns the deleted id', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'mem-1' }]);

    const result = await deleteMemory('mem-1');

    expect(sqlText()).toContain('DELETE FROM memories');
    expect(sqlText()).toContain('RETURNING id');
    expect(sqlParams()).toEqual(['mem-1']);
    expect(result).toEqual({ id: 'mem-1' });
  });

  it('throws an explicit not-found error when no row matches', async () => {
    mockSql.mockResolvedValueOnce([]);

    await expect(deleteMemory('missing-id')).rejects.toThrow('Memory not found: missing-id');
  });

  it('wraps driver errors with a sanitized message', async () => {
    mockSql.mockRejectedValueOnce(new Error('connection refused'));

    await expect(deleteMemory('mem-1')).rejects.toThrow('Database operation failed');
  });
});
