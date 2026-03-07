import type { SearchResult } from '../types.js';

vi.mock('../services/embedding.js', () => ({
  generateEmbedding: vi.fn(),
}));

vi.mock('../db/queries.js', () => ({
  searchMemories: vi.fn(),
}));

import { handleSearchBrain } from './search-brain.js';
import { generateEmbedding } from '../services/embedding.js';
import { searchMemories } from '../db/queries.js';

const mockGenerateEmbedding = vi.mocked(generateEmbedding);
const mockSearchMemories = vi.mocked(searchMemories);

const FAKE_VECTOR = [0.1, 0.2, 0.3];

const FAKE_RESULT: SearchResult = {
  id: 'mem-1',
  raw_text: 'some memory text',
  captured_at: '2026-01-01T00:00:00.000Z',
  source: 'api',
  metadata: {
    type: 'insight',
    topics: [],
    people: [],
    action_items: [],
    confidence: 0.8,
    truncated: false,
  },
  metadata_status: 'ready',
  embedding_status: 'ready',
  similarity_score: 0.95,
};

describe('handleSearchBrain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateEmbedding.mockResolvedValue(FAKE_VECTOR);
    mockSearchMemories.mockResolvedValue([FAKE_RESULT]);
  });

  it('clamps n to max 50', async () => {
    await handleSearchBrain({ query: 'test', n: 200 });

    expect(mockSearchMemories).toHaveBeenCalledWith(
      FAKE_VECTOR,
      50,
      undefined,
      undefined,
    );
  });

  it('clamps n to min 1', async () => {
    await handleSearchBrain({ query: 'test', n: -5 });

    expect(mockSearchMemories).toHaveBeenCalledWith(
      FAKE_VECTOR,
      1,
      undefined,
      undefined,
    );
  });

  it('defaults n to 10', async () => {
    await handleSearchBrain({ query: 'test' });

    expect(mockSearchMemories).toHaveBeenCalledWith(
      FAKE_VECTOR,
      10,
      undefined,
      undefined,
    );
  });

  it('wraps raw_text when wrap_output=true', async () => {
    const results = await handleSearchBrain({ query: 'test', wrap_output: true });

    expect(results[0].raw_text).toBe(
      `<memory_content>\nsome memory text\n</memory_content>`,
    );
  });

  it('does not wrap raw_text when wrap_output is falsy', async () => {
    const results = await handleSearchBrain({ query: 'test' });

    expect(results[0].raw_text).toBe('some memory text');
  });

  it('passes filter_type and since to searchMemories', async () => {
    await handleSearchBrain({
      query: 'test',
      filter_type: 'decision',
      since: '2026-01-01',
    });

    expect(mockSearchMemories).toHaveBeenCalledWith(
      FAKE_VECTOR,
      10,
      'decision',
      '2026-01-01',
    );
  });

  it('throws error when embedding generation fails', async () => {
    mockGenerateEmbedding.mockResolvedValue(null as any);

    await expect(handleSearchBrain({ query: 'test' })).rejects.toThrow(
      'Failed to generate embedding for search query',
    );
  });
});
