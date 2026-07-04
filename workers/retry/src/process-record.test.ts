import type { RetryEligibleMemory } from 'open-brain-workers-shared';

const {
  mockUpdateMemoryEmbedding,
  mockUpdateMemoryMetadata,
  mockIncrementEmbeddingRetry,
  mockIncrementMetadataRetry,
  mockGenerateEmbedding,
  mockExtractMetadata,
} = vi.hoisted(() => ({
  mockUpdateMemoryEmbedding: vi.fn(),
  mockUpdateMemoryMetadata: vi.fn(),
  mockIncrementEmbeddingRetry: vi.fn(),
  mockIncrementMetadataRetry: vi.fn(),
  mockGenerateEmbedding: vi.fn(),
  mockExtractMetadata: vi.fn(),
}));

vi.mock('open-brain-workers-shared', () => ({
  updateMemoryEmbedding: mockUpdateMemoryEmbedding,
  updateMemoryMetadata: mockUpdateMemoryMetadata,
  incrementEmbeddingRetry: mockIncrementEmbeddingRetry,
  incrementMetadataRetry: mockIncrementMetadataRetry,
}));
vi.mock('./embedding-service.js', () => ({ generateEmbedding: mockGenerateEmbedding }));
vi.mock('./metadata-service.js', () => ({ extractMetadata: mockExtractMetadata }));

import { processRecord } from './process-record.js';

const sql = {} as never;

const ENV = {
  DATABASE_URL: 'postgres://test',
  OPENAI_API_KEY: 'sk-openai',
  ANTHROPIC_API_KEY: 'sk-anthropic',
};

function record(overrides: Partial<RetryEligibleMemory> = {}): RetryEligibleMemory {
  return {
    id: 'mem-1',
    embedding_status: 'ready',
    metadata_status: 'ready',
    retry_count_embedding: 0,
    retry_count_metadata: 0,
    captured_at: '2026-07-01T00:00:00.000Z',
    raw_text: 'some captured text',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('processRecord', () => {
  it('skips both when neither status is eligible', async () => {
    const result = await processRecord(sql, record(), ENV);

    expect(result).toEqual({ id: 'mem-1', embedding: 'skipped', metadata: 'skipped' });
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(mockExtractMetadata).not.toHaveBeenCalled();
  });

  it('retries a pending embedding to success', async () => {
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2]);

    const result = await processRecord(sql, record({ embedding_status: 'pending' }), ENV);

    expect(result.embedding).toBe('success');
    expect(mockGenerateEmbedding).toHaveBeenCalledWith('some captured text', 'sk-openai');
    expect(mockUpdateMemoryEmbedding).toHaveBeenCalledWith(sql, 'mem-1', [0.1, 0.2]);
    expect(mockIncrementEmbeddingRetry).not.toHaveBeenCalled();
  });

  it('increments the embedding retry count on failure', async () => {
    mockGenerateEmbedding.mockRejectedValue(new Error('OpenAI down'));

    const result = await processRecord(sql, record({ embedding_status: 'pending' }), ENV);

    expect(result.embedding).toBe('failure');
    expect(mockIncrementEmbeddingRetry).toHaveBeenCalledWith(sql, 'mem-1', 'OpenAI down');
    expect(mockUpdateMemoryEmbedding).not.toHaveBeenCalled();
  });

  it('retries degraded metadata to success', async () => {
    const metadata = {
      type: 'insight',
      topics: [],
      people: [],
      action_items: [],
      confidence: 0.5,
      truncated: false,
    };
    mockExtractMetadata.mockResolvedValue(metadata);

    const result = await processRecord(sql, record({ metadata_status: 'degraded' }), ENV);

    expect(result.metadata).toBe('success');
    expect(mockExtractMetadata).toHaveBeenCalledWith(
      'some captured text',
      'anthropic',
      'sk-anthropic',
      null,
    );
    expect(mockUpdateMemoryMetadata).toHaveBeenCalledWith(sql, 'mem-1', metadata);
  });

  it('increments the metadata retry count on failure', async () => {
    mockExtractMetadata.mockRejectedValue(new Error('LLM timeout'));

    const result = await processRecord(sql, record({ metadata_status: 'degraded' }), ENV);

    expect(result.metadata).toBe('failure');
    expect(mockIncrementMetadataRetry).toHaveBeenCalledWith(sql, 'mem-1', 'LLM timeout');
  });

  it('processes embedding and metadata in parallel when both are eligible', async () => {
    mockGenerateEmbedding.mockResolvedValue([0.1]);
    mockExtractMetadata.mockResolvedValue({
      type: 'task',
      topics: [],
      people: [],
      action_items: [],
      confidence: 1,
      truncated: false,
    });

    const result = await processRecord(
      sql,
      record({ embedding_status: 'pending', metadata_status: 'degraded' }),
      ENV,
    );

    expect(result).toEqual({ id: 'mem-1', embedding: 'success', metadata: 'success' });
  });

  it('defaults the metadata provider to anthropic when unset', async () => {
    mockExtractMetadata.mockResolvedValue({
      type: 'task',
      topics: [],
      people: [],
      action_items: [],
      confidence: 1,
      truncated: false,
    });

    await processRecord(sql, record({ metadata_status: 'degraded' }), {
      DATABASE_URL: 'postgres://test',
      OPENAI_API_KEY: 'sk-openai',
    });

    expect(mockExtractMetadata).toHaveBeenCalledWith('some captured text', 'anthropic', null, null);
  });
});
