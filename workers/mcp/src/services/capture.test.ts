import type { CaptureResult, ExtractedMetadata } from 'open-brain-workers-shared';

vi.mock('open-brain-workers-shared', async () => {
  const actual = await vi.importActual<typeof import('open-brain-workers-shared')>('open-brain-workers-shared');
  return { ...actual, insertMemory: vi.fn(), fetchEmbedding: vi.fn(), extractMetadata: vi.fn() };
});

import { captureMemory, CaptureValidationError, DbWriteError } from './capture.js';
import { extractMetadata, fetchEmbedding, insertMemory } from 'open-brain-workers-shared';

const mockFetchEmbedding = vi.mocked(fetchEmbedding);
const mockExtractMetadata = vi.mocked(extractMetadata);
const mockInsertMemory = vi.mocked(insertMemory);

const GOOD_METADATA: ExtractedMetadata = {
  type: 'insight',
  topics: ['testing'],
  people: [],
  action_items: [],
  confidence: 0.9,
  truncated: false,
};

const FAKE_EMBEDDING = [0.1, 0.2, 0.3];
const FAKE_SQL = {} as import('open-brain-workers-shared').Db;
const FAKE_CONFIG = { apiKey: 'sk-test', metadataConfig: {} };

function makeCaptureResult(overrides: Partial<CaptureResult> = {}): CaptureResult {
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockFetchEmbedding.mockResolvedValue(FAKE_EMBEDDING);
  mockExtractMetadata.mockResolvedValue(GOOD_METADATA);
  mockInsertMemory.mockImplementation(async (_sql, record) =>
    makeCaptureResult({
      id: record.id,
      captured_at: record.captured_at,
      source: record.source,
      embedding_status: record.embedding_status,
      metadata_status: record.metadata_status,
      metadata: record.metadata,
    }),
  );
});

describe('captureMemory', () => {
  it('throws CaptureValidationError with INVALID_TEXT for empty text', async () => {
    await expect(captureMemory(FAKE_SQL, '', undefined, FAKE_CONFIG)).rejects.toThrow(CaptureValidationError);
  });

  it('throws CaptureValidationError with INVALID_TEXT for whitespace-only text', async () => {
    await expect(captureMemory(FAKE_SQL, '   ', undefined, FAKE_CONFIG)).rejects.toThrow(CaptureValidationError);
  });

  it('throws CaptureValidationError with INVALID_TEXT for text > 10000 chars', async () => {
    const longText = 'a'.repeat(10_001);
    await expect(captureMemory(FAKE_SQL, longText, undefined, FAKE_CONFIG)).rejects.toThrow(CaptureValidationError);
  });

  it('throws CaptureValidationError with INVALID_SOURCE for invalid source', async () => {
    await expect(
      captureMemory(FAKE_SQL, 'hello', 'twitter' as never, FAKE_CONFIG),
    ).rejects.toThrow(CaptureValidationError);
  });

  it("defaults source to 'mcp_direct' when not provided", async () => {
    await captureMemory(FAKE_SQL, 'hello world', undefined, FAKE_CONFIG);
    expect(mockInsertMemory).toHaveBeenCalledWith(
      FAKE_SQL,
      expect.objectContaining({ source: 'mcp_direct' }),
    );
  });

  it('calls embedding and metadata in parallel', async () => {
    await captureMemory(FAKE_SQL, 'test parallel', undefined, FAKE_CONFIG);

    expect(mockFetchEmbedding).toHaveBeenCalledTimes(1);
    expect(mockExtractMetadata).toHaveBeenCalledTimes(1);
  });

  it('returns CaptureResult with correct fields when both succeed', async () => {
    const result = await captureMemory(FAKE_SQL, 'test text', 'claude', FAKE_CONFIG);

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

  it('returns pending embedding_status when embedding fails', async () => {
    mockFetchEmbedding.mockRejectedValue(new Error('OpenAI embedding API 500'));

    const result = await captureMemory(FAKE_SQL, 'test text', undefined, FAKE_CONFIG);

    expect(mockInsertMemory).toHaveBeenCalledWith(
      FAKE_SQL,
      expect.objectContaining({ embedding: null, embedding_status: 'pending' }),
    );
    expect(result.embedding_status).toBe('pending');
  });

  it('returns degraded metadata_status when metadata extraction fails', async () => {
    mockExtractMetadata.mockRejectedValue(new Error('metadata provider unavailable'));

    const result = await captureMemory(FAKE_SQL, 'test text', undefined, FAKE_CONFIG);

    expect(result.metadata_status).toBe('degraded');
  });

  it('throws DbWriteError when DB write fails', async () => {
    mockInsertMemory.mockRejectedValue(new Error('connection refused'));

    await expect(captureMemory(FAKE_SQL, 'test text', undefined, FAKE_CONFIG)).rejects.toThrow(DbWriteError);
  });

  it('logs and continues when embedding rejects unexpectedly', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetchEmbedding.mockRejectedValueOnce(new Error('runtime crash'));

    const result = await captureMemory(FAKE_SQL, 'test text', undefined, FAKE_CONFIG);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('runtime crash'));
    expect(result.embedding_status).toBe('pending');
  });

  it('logs and falls back to degraded metadata when metadata extraction rejects unexpectedly', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockExtractMetadata.mockRejectedValueOnce(new Error('metadata crash'));

    const result = await captureMemory(FAKE_SQL, 'test text', undefined, FAKE_CONFIG);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('metadata crash'));
    expect(result.metadata_status).toBe('degraded');
  });
});
