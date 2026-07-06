import type { StatsResponse } from 'open-brain-workers-shared';

vi.mock('open-brain-workers-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('open-brain-workers-shared')>();
  return { ...actual, getStats: vi.fn() };
});

import { handleGetStats } from './get-stats.js';
import { getStats } from 'open-brain-workers-shared';

const mockGetStats = vi.mocked(getStats);
const FAKE_SQL = {} as import('open-brain-workers-shared').Db;

const FAKE_STATS: StatsResponse = {
  total_memories: 10,
  last_7_days: 2,
  last_30_days: 5,
  by_type: { insight: 10 },
  by_embedding_status: { ready: 10, pending: 0, failed: 0 },
  embedding_model: 'text-embedding-3-small',
  top_topics: [{ topic: 'testing', count: 3 }],
};

describe('handleGetStats', () => {
  it('returns the stats from getStats', async () => {
    mockGetStats.mockResolvedValue(FAKE_STATS);

    const result = await handleGetStats(FAKE_SQL);

    expect(mockGetStats).toHaveBeenCalledWith(FAKE_SQL);
    expect(result).toEqual(FAKE_STATS);
  });
});
