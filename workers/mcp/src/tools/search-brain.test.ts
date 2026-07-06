import type { SearchResult } from 'open-brain-workers-shared';

vi.mock('open-brain-workers-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('open-brain-workers-shared')>();
  return { ...actual, fetchEmbedding: vi.fn(), searchMemories: vi.fn() };
});

import { handleSearchBrain } from './search-brain.js';
import { fetchEmbedding } from 'open-brain-workers-shared';
import { searchMemories } from 'open-brain-workers-shared';

const mockFetchEmbedding = vi.mocked(fetchEmbedding);
const mockSearchMemories = vi.mocked(searchMemories);

const FAKE_VECTOR = [0.1, 0.2, 0.3];
const FAKE_SQL = {} as import('open-brain-workers-shared').Db;

const FAKE_RESULT: SearchResult = {
  id: 'mem-1',
  raw_text: 'some memory text',
  captured_at: '2026-01-01T00:00:00.000Z',
  source: 'api',
  metadata: { type: 'insight', topics: [], people: [], action_items: [], confidence: 0.8, truncated: false },
  metadata_status: 'ready',
  embedding_status: 'ready',
  similarity_score: 0.95,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchEmbedding.mockResolvedValue(FAKE_VECTOR);
  mockSearchMemories.mockResolvedValue([FAKE_RESULT]);
});

describe('handleSearchBrain', () => {
  it('clamps n to max 50', async () => {
    await handleSearchBrain(FAKE_SQL, 'sk-test', { query: 'test', n: 200 });
    expect(mockSearchMemories).toHaveBeenCalledWith(FAKE_SQL, FAKE_VECTOR, 50, undefined, undefined);
  });

  it('clamps n to min 1', async () => {
    await handleSearchBrain(FAKE_SQL, 'sk-test', { query: 'test', n: -5 });
    expect(mockSearchMemories).toHaveBeenCalledWith(FAKE_SQL, FAKE_VECTOR, 1, undefined, undefined);
  });

  it('defaults n to 10', async () => {
    await handleSearchBrain(FAKE_SQL, 'sk-test', { query: 'test' });
    expect(mockSearchMemories).toHaveBeenCalledWith(FAKE_SQL, FAKE_VECTOR, 10, undefined, undefined);
  });

  it('wraps raw_text when wrap_output=true', async () => {
    const results = await handleSearchBrain(FAKE_SQL, 'sk-test', { query: 'test', wrap_output: true });
    expect(results[0].raw_text).toBe(`<memory_content>\nsome memory text\n</memory_content>`);
  });

  it('does not wrap raw_text when wrap_output is falsy', async () => {
    const results = await handleSearchBrain(FAKE_SQL, 'sk-test', { query: 'test' });
    expect(results[0].raw_text).toBe('some memory text');
  });

  it('passes filter_type and since to searchMemories', async () => {
    await handleSearchBrain(FAKE_SQL, 'sk-test', { query: 'test', filter_type: 'decision', since: '2026-01-01' });
    expect(mockSearchMemories).toHaveBeenCalledWith(FAKE_SQL, FAKE_VECTOR, 10, 'decision', '2026-01-01');
  });

  it('propagates embedding failures without querying the database', async () => {
    mockFetchEmbedding.mockRejectedValue(new Error('OpenAI embedding API 500'));
    await expect(handleSearchBrain(FAKE_SQL, 'sk-test', { query: 'test' })).rejects.toThrow(
      'OpenAI embedding API 500',
    );
    expect(mockSearchMemories).not.toHaveBeenCalled();
  });
});
