import type { RecentMemory } from 'open-brain-workers-shared';

vi.mock('open-brain-workers-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('open-brain-workers-shared')>();
  return { ...actual, listRecentMemories: vi.fn() };
});

import { handleListRecent } from './list-recent.js';
import { listRecentMemories } from 'open-brain-workers-shared';

const mockListRecentMemories = vi.mocked(listRecentMemories);
const FAKE_SQL = {} as import('open-brain-workers-shared').Db;

const FAKE_MEMORY: RecentMemory = {
  id: 'mem-1',
  raw_text: 'some memory text',
  metadata: { type: 'insight', topics: [], people: [], action_items: [], confidence: 0.8, truncated: false },
  metadata_status: 'ready',
  captured_at: '2026-01-01T00:00:00.000Z',
  source: 'api',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockListRecentMemories.mockResolvedValue([FAKE_MEMORY]);
});

describe('handleListRecent', () => {
  it('clamps n to max 100', async () => {
    await handleListRecent(FAKE_SQL, { n: 500 });
    expect(mockListRecentMemories).toHaveBeenCalledWith(FAKE_SQL, 100, undefined);
  });

  it('clamps n to min 1', async () => {
    await handleListRecent(FAKE_SQL, { n: -5 });
    expect(mockListRecentMemories).toHaveBeenCalledWith(FAKE_SQL, 1, undefined);
  });

  it('defaults n to 20', async () => {
    await handleListRecent(FAKE_SQL, {});
    expect(mockListRecentMemories).toHaveBeenCalledWith(FAKE_SQL, 20, undefined);
  });

  it('passes filter_type through', async () => {
    await handleListRecent(FAKE_SQL, { filter_type: 'task' });
    expect(mockListRecentMemories).toHaveBeenCalledWith(FAKE_SQL, 20, 'task');
  });

  it('wraps raw_text when wrap_output=true', async () => {
    const results = await handleListRecent(FAKE_SQL, { wrap_output: true });
    expect(results[0].raw_text).toBe(`<memory_content>\nsome memory text\n</memory_content>`);
  });

  it('does not wrap raw_text by default', async () => {
    const results = await handleListRecent(FAKE_SQL, {});
    expect(results[0].raw_text).toBe('some memory text');
  });
});
