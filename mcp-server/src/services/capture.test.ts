import type { CaptureResponse, MemoryMetadata } from '../types.js';
import { DEGRADED_METADATA } from '../types.js';

vi.mock('./embedding.js', () => ({
  generateEmbedding: vi.fn(),
}));

vi.mock('./metadata.js', () => ({
  extractMetadata: vi.fn(),
}));

vi.mock('../db/queries.js', () => ({
  insertMemory: vi.fn(),
}));

import { captureMemory, CaptureValidationError, DbWriteError } from './capture.js';
import { generateEmbedding } from './embedding.js';
import { extractMetadata } from './metadata.js';
import { insertMemory } from '../db/queries.js';

const mockGenerateEmbedding = vi.mocked(generateEmbedding);
const mockExtractMetadata = vi.mocked(extractMetadata);
const mockInsertMemory = vi.mocked(insertMemory);

const GOOD_METADATA: MemoryMetadata = {
  type: 'insight',
  topics: ['testing'],
  people: [],
  action_items: [],
  confidence: 0.9,
  truncated: false,
};

const FAKE_EMBEDDING = [0.1, 0.2, 0.3];

function makeCaptureResponse(overrides: Partial<CaptureResponse> = {}): CaptureResponse {
  return {
    id: 'test-uuid',
    captured_at: '2026-01-01T00:00:00.000Z',
    source: 'api',
    embedding_status: 'ready',
    metadata_status: 'ready',
    metadata: GOOD_METADATA,
    ...overrides,
  };
}

describe('captureMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateEmbedding.mockResolvedValue(FAKE_EMBEDDING);
    mockExtractMetadata.mockResolvedValue({ metadata: GOOD_METADATA, status: 'ready' });
    mockInsertMemory.mockImplementation(async (record) =>
      makeCaptureResponse({
        id: record.id,
        captured_at: record.captured_at,
        source: record.source,
        embedding_status: record.embedding_status,
        metadata_status: record.metadata_status,
        metadata: record.metadata,
      }),
    );
  });

  it('throws CaptureValidationError with INVALID_TEXT for empty text', async () => {
    await expect(captureMemory('')).rejects.toThrow(CaptureValidationError);
    try {
      await captureMemory('');
    } catch (e) {
      expect((e as CaptureValidationError).code).toBe('INVALID_TEXT');
    }
  });

  it('throws CaptureValidationError with INVALID_TEXT for whitespace-only text', async () => {
    await expect(captureMemory('   ')).rejects.toThrow(CaptureValidationError);
    try {
      await captureMemory('   ');
    } catch (e) {
      expect((e as CaptureValidationError).code).toBe('INVALID_TEXT');
    }
  });

  it('throws CaptureValidationError with INVALID_TEXT for text > 10000 chars', async () => {
    const longText = 'a'.repeat(10_001);
    await expect(captureMemory(longText)).rejects.toThrow(CaptureValidationError);
    try {
      await captureMemory(longText);
    } catch (e) {
      expect((e as CaptureValidationError).code).toBe('INVALID_TEXT');
    }
  });

  it('throws CaptureValidationError with INVALID_SOURCE for invalid source', async () => {
    await expect(captureMemory('hello', 'twitter' as any)).rejects.toThrow(CaptureValidationError);
    try {
      await captureMemory('hello', 'twitter' as any);
    } catch (e) {
      expect((e as CaptureValidationError).code).toBe('INVALID_SOURCE');
    }
  });

  it("defaults source to 'api' when not provided", async () => {
    await captureMemory('hello world');
    expect(mockInsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'api' }),
    );
  });

  it('calls embedding and metadata in parallel', async () => {
    const callOrder: string[] = [];
    mockGenerateEmbedding.mockImplementation(async () => {
      callOrder.push('embedding-start');
      return FAKE_EMBEDDING;
    });
    mockExtractMetadata.mockImplementation(async () => {
      callOrder.push('metadata-start');
      return { metadata: GOOD_METADATA, status: 'ready' as const };
    });

    await captureMemory('test parallel');

    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
    expect(mockExtractMetadata).toHaveBeenCalledTimes(1);
    // Both should be called (Promise.allSettled runs them concurrently)
    expect(callOrder).toContain('embedding-start');
    expect(callOrder).toContain('metadata-start');
  });

  it('returns CaptureResponse with correct fields when both succeed', async () => {
    const result = await captureMemory('test text', 'claude');

    expect(result).toEqual(
      expect.objectContaining({
        source: 'claude',
        embedding_status: 'ready',
        metadata_status: 'ready',
        metadata: GOOD_METADATA,
      }),
    );
    expect(result.id).toBeDefined();
    expect(result.captured_at).toBeDefined();
  });

  it("returns pending embedding_status when embedding fails", async () => {
    mockGenerateEmbedding.mockRejectedValue(new Error('OpenAI down'));

    const result = await captureMemory('test text');

    expect(mockInsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        embedding: null,
        embedding_status: 'pending',
      }),
    );
    expect(result.embedding_status).toBe('pending');
  });

  it('returns degraded metadata_status when metadata fails', async () => {
    mockExtractMetadata.mockRejectedValue(new Error('LLM down'));

    const result = await captureMemory('test text');

    expect(mockInsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: DEGRADED_METADATA,
        metadata_status: 'degraded',
      }),
    );
    expect(result.metadata_status).toBe('degraded');
  });

  it('returns both degraded when both fail', async () => {
    mockGenerateEmbedding.mockRejectedValue(new Error('OpenAI down'));
    mockExtractMetadata.mockRejectedValue(new Error('LLM down'));

    const result = await captureMemory('test text');

    expect(mockInsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        embedding: null,
        embedding_status: 'pending',
        metadata: DEGRADED_METADATA,
        metadata_status: 'degraded',
      }),
    );
    expect(result.embedding_status).toBe('pending');
    expect(result.metadata_status).toBe('degraded');
  });

  it('should log rejection reason when embedding throws unexpected error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGenerateEmbedding.mockRejectedValueOnce(new Error('runtime crash'));

    await captureMemory('test text', 'api');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('runtime crash'));
    consoleSpy.mockRestore();
  });

  it('should log rejection reason when metadata throws unexpected error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockExtractMetadata.mockRejectedValueOnce(new Error('metadata crash'));

    await captureMemory('test text', 'api');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('metadata crash'));
    consoleSpy.mockRestore();
  });

  it('throws DbWriteError when DB write fails', async () => {
    mockInsertMemory.mockRejectedValue(new Error('connection refused'));

    await expect(captureMemory('test text')).rejects.toThrow(DbWriteError);
    await expect(captureMemory('test text')).rejects.toThrow('connection refused');
  });
});
