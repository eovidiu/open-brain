const { mockCreateDb, mockGetRetryEligibleMemories, mockProcessRecord } = vi.hoisted(() => ({
  mockCreateDb: vi.fn(),
  mockGetRetryEligibleMemories: vi.fn(),
  mockProcessRecord: vi.fn(),
}));

vi.mock('open-brain-workers-shared', () => ({
  createDb: mockCreateDb,
  getRetryEligibleMemories: mockGetRetryEligibleMemories,
}));
vi.mock('./process-record.js', () => ({ processRecord: mockProcessRecord }));

import { runRetryBatch } from './retry-batch.js';

const ENV = { DATABASE_URL: 'postgres://test', OPENAI_API_KEY: 'sk-openai' };
const sql = { tag: 'sql-handle' };

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateDb.mockReturnValue(sql);
});

describe('runRetryBatch', () => {
  it('returns a zeroed summary when nothing is eligible', async () => {
    mockGetRetryEligibleMemories.mockResolvedValue([]);

    const summary = await runRetryBatch(ENV);

    expect(summary).toEqual({ processed: 0, succeeded: 0, failed: 0 });
    expect(mockProcessRecord).not.toHaveBeenCalled();
  });

  it('queries with the batch limit of 20 and uses the created db handle', async () => {
    mockGetRetryEligibleMemories.mockResolvedValue([]);

    await runRetryBatch(ENV);

    expect(mockCreateDb).toHaveBeenCalledWith('postgres://test');
    expect(mockGetRetryEligibleMemories).toHaveBeenCalledWith(sql, 20);
  });

  it('processes every eligible record and tallies success/failure', async () => {
    mockGetRetryEligibleMemories.mockResolvedValue([
      { id: 'mem-1' },
      { id: 'mem-2' },
      { id: 'mem-3' },
    ]);
    mockProcessRecord
      .mockResolvedValueOnce({ id: 'mem-1', embedding: 'success', metadata: 'skipped' })
      .mockResolvedValueOnce({ id: 'mem-2', embedding: 'failure', metadata: 'skipped' })
      .mockResolvedValueOnce({ id: 'mem-3', embedding: 'skipped', metadata: 'skipped' });

    const summary = await runRetryBatch(ENV);

    expect(summary).toEqual({ processed: 3, succeeded: 1, failed: 1 });
    expect(mockProcessRecord).toHaveBeenCalledTimes(3);
    expect(mockProcessRecord).toHaveBeenCalledWith(sql, { id: 'mem-1' }, ENV);
  });

  it('counts a record as succeeded if either embedding or metadata succeeded', async () => {
    mockGetRetryEligibleMemories.mockResolvedValue([{ id: 'mem-1' }]);
    mockProcessRecord.mockResolvedValue({ id: 'mem-1', embedding: 'success', metadata: 'failure' });

    const summary = await runRetryBatch(ENV);

    expect(summary).toEqual({ processed: 1, succeeded: 1, failed: 1 });
  });
});
