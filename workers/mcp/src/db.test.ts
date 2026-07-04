import type { MemoryMetadata } from 'open-brain-workers-shared';
import { getStats, getSystemConfig, listRecentMemories, searchMemories } from './db.js';

const METADATA: MemoryMetadata = {
  type: 'insight',
  topics: ['testing'],
  people: [],
  action_items: [],
  confidence: 0.9,
  truncated: false,
};

const VECTOR = [0.1, 0.2, 0.3];

function makeMockSql(resolvedValue: unknown) {
  const mock = vi.fn().mockResolvedValue(resolvedValue);
  return mock as unknown as import('open-brain-workers-shared').Db;
}

function sqlText(mock: ReturnType<typeof vi.fn>, callIndex = 0): string {
  const call = mock.mock.calls[callIndex];
  return (call[0] as readonly string[]).join('?');
}

function sqlParams(mock: ReturnType<typeof vi.fn>, callIndex = 0): unknown[] {
  return mock.mock.calls[callIndex].slice(1);
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('searchMemories', () => {
  it('calls search_memories with the vector, n, filter_type, and since', async () => {
    const row = {
      id: 'mem-1',
      raw_text: 'hello',
      captured_at: new Date('2026-07-04T00:00:00.000Z'),
      source: 'api',
      metadata: METADATA,
      metadata_status: 'ready',
      embedding_status: 'ready',
      similarity_score: 0.95,
    };
    const mockSql = vi.fn().mockResolvedValue([row]);
    const sql = mockSql as unknown as import('open-brain-workers-shared').Db;

    const results = await searchMemories(sql, VECTOR, 10, 'insight', '2026-01-01');

    expect(sqlText(mockSql)).toContain('search_memories');
    expect(sqlParams(mockSql)).toEqual([JSON.stringify(VECTOR), 10, 'insight', '2026-01-01']);
    expect(results).toEqual([
      {
        id: 'mem-1',
        raw_text: 'hello',
        captured_at: '2026-07-04T00:00:00.000Z',
        source: 'api',
        metadata: METADATA,
        metadata_status: 'ready',
        embedding_status: 'ready',
        similarity_score: 0.95,
      },
    ]);
  });

  it('passes null for omitted filter_type/since', async () => {
    const mockSql = vi.fn().mockResolvedValue([]);
    const sql = mockSql as unknown as import('open-brain-workers-shared').Db;

    await searchMemories(sql, VECTOR, 5);

    expect(sqlParams(mockSql)).toEqual([JSON.stringify(VECTOR), 5, null, null]);
  });

  it('wraps a driver error with a sanitized message', async () => {
    const mockSql = vi.fn().mockRejectedValue(new Error('connection refused'));
    const sql = mockSql as unknown as import('open-brain-workers-shared').Db;

    await expect(searchMemories(sql, VECTOR, 5)).rejects.toThrow('Database operation failed');
  });
});

describe('listRecentMemories', () => {
  it('lists without a filter', async () => {
    const row = {
      id: 'mem-1',
      raw_text: 'hello',
      metadata: METADATA,
      metadata_status: 'ready',
      captured_at: new Date('2026-07-04T00:00:00.000Z'),
      source: 'api',
    };
    const mockSql = vi.fn().mockResolvedValue([row]);
    const sql = mockSql as unknown as import('open-brain-workers-shared').Db;

    const results = await listRecentMemories(sql, 20);

    expect(sqlText(mockSql)).toContain('ORDER BY captured_at DESC');
    expect(results).toEqual([
      {
        id: 'mem-1',
        raw_text: 'hello',
        metadata: METADATA,
        metadata_status: 'ready',
        captured_at: '2026-07-04T00:00:00.000Z',
        source: 'api',
      },
    ]);
  });

  it('filters by metadata type when filter_type is given', async () => {
    const mockSql = vi.fn().mockResolvedValue([]);
    const sql = mockSql as unknown as import('open-brain-workers-shared').Db;

    await listRecentMemories(sql, 20, 'task');

    expect(sqlText(mockSql)).toContain("metadata->>'type'");
  });
});

describe('getStats', () => {
  it('maps the get_memory_stats() row', async () => {
    const stats = {
      total_memories: 10,
      last_7_days: 2,
      last_30_days: 5,
      by_type: { insight: 10 },
      by_embedding_status: { ready: 10, pending: 0, failed: 0 },
      embedding_model: 'text-embedding-3-small',
      top_topics: [{ topic: 'testing', count: 3 }],
    };
    const mockSql = makeMockSql([{ stats }]);

    const result = await getStats(mockSql);

    expect(result).toEqual(stats);
  });
});

describe('getSystemConfig', () => {
  it('maps the system_config row', async () => {
    const row = {
      id: 1,
      embedding_model: 'text-embedding-3-small',
      embedding_dimensions: 1536,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-02T00:00:00.000Z'),
    };
    const mockSql = makeMockSql([row]);

    const result = await getSystemConfig(mockSql);

    expect(result).toEqual({
      id: 1,
      embedding_model: 'text-embedding-3-small',
      embedding_dimensions: 1536,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    });
  });

  it('throws when system_config row is missing', async () => {
    const mockSql = makeMockSql([]);

    await expect(getSystemConfig(mockSql)).rejects.toThrow('Database operation failed');
  });
});
