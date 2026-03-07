import type { Memory } from '../types.js';

vi.mock('../db/queries.js', () => ({
  listRecentMemories: vi.fn(),
}));

import { handleListRecent } from './list-recent.js';
import { listRecentMemories } from '../db/queries.js';

const mockListRecentMemories = vi.mocked(listRecentMemories);

const FAKE_MEMORY: Memory = {
  id: 'mem-1',
  raw_text: 'some text',
  embedding: [0.1, 0.2],
  embedding_status: 'ready',
  metadata: {
    type: 'insight',
    topics: ['testing'],
    people: [],
    action_items: [],
    confidence: 0.9,
    truncated: false,
  },
  metadata_status: 'ready',
  captured_at: '2026-01-01T00:00:00.000Z',
  source: 'api',
  retry_count_embedding: 2,
  retry_count_metadata: 1,
  last_processing_error: 'some transient error',
};

describe('handleListRecent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListRecentMemories.mockResolvedValue([FAKE_MEMORY]);
  });

  it('clamps n to max 100', async () => {
    await handleListRecent({ n: 500 });

    expect(mockListRecentMemories).toHaveBeenCalledWith(100, undefined);
  });

  it('clamps n to min 1', async () => {
    await handleListRecent({ n: 0 });

    expect(mockListRecentMemories).toHaveBeenCalledWith(1, undefined);
  });

  it('defaults n to 20', async () => {
    await handleListRecent({});

    expect(mockListRecentMemories).toHaveBeenCalledWith(20, undefined);
  });

  it('excludes internal fields (embedding, retry counts, etc.) from output', async () => {
    const results = await handleListRecent({});

    expect(results).toHaveLength(1);
    const item = results[0] as Record<string, unknown>;
    expect(item).not.toHaveProperty('embedding');
    expect(item).not.toHaveProperty('retry_count_embedding');
    expect(item).not.toHaveProperty('retry_count_metadata');
    expect(item).not.toHaveProperty('last_processing_error');

    // Public fields should still be present
    expect(item).toHaveProperty('id', 'mem-1');
    expect(item).toHaveProperty('raw_text', 'some text');
    expect(item).toHaveProperty('embedding_status', 'ready');
    expect(item).toHaveProperty('metadata');
    expect(item).toHaveProperty('captured_at');
    expect(item).toHaveProperty('source', 'api');
  });

  it('passes filter_type to listRecentMemories', async () => {
    await handleListRecent({ filter_type: 'decision' });

    expect(mockListRecentMemories).toHaveBeenCalledWith(20, 'decision');
  });
});
