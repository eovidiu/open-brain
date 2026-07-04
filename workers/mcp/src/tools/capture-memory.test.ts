import type { CaptureResult } from 'open-brain-workers-shared';

vi.mock('../services/capture.js', async () => {
  const actual = await vi.importActual<typeof import('../services/capture.js')>('../services/capture.js');
  return { ...actual, captureMemory: vi.fn() };
});

import { handleCaptureMemory } from './capture-memory.js';
import { captureMemory } from '../services/capture.js';

const mockCaptureMemory = vi.mocked(captureMemory);
const FAKE_SQL = {} as import('open-brain-workers-shared').Db;
const FAKE_CONFIG = { apiKey: 'sk-test', metadataConfig: {} };

const FAKE_RESULT: CaptureResult = {
  id: 'mem-1',
  captured_at: '2026-01-01T00:00:00.000Z',
  source: 'mcp_direct',
  embedding_status: 'ready',
  metadata_status: 'ready',
  metadata: { type: 'insight', topics: [], people: [], action_items: [], confidence: 0.8, truncated: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCaptureMemory.mockResolvedValue(FAKE_RESULT);
});

describe('handleCaptureMemory', () => {
  it('delegates to captureMemory with sql, text, source, and config', async () => {
    const result = await handleCaptureMemory(FAKE_SQL, FAKE_CONFIG, { text: 'hello', source: 'claude' });

    expect(mockCaptureMemory).toHaveBeenCalledWith(FAKE_SQL, 'hello', 'claude', FAKE_CONFIG);
    expect(result).toEqual(FAKE_RESULT);
  });

  it('passes source through as undefined when omitted', async () => {
    await handleCaptureMemory(FAKE_SQL, FAKE_CONFIG, { text: 'hello' });
    expect(mockCaptureMemory).toHaveBeenCalledWith(FAKE_SQL, 'hello', undefined, FAKE_CONFIG);
  });
});
