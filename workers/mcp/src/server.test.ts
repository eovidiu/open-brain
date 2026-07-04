import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('./tools/search-brain.js', () => ({ handleSearchBrain: vi.fn() }));
vi.mock('./tools/list-recent.js', () => ({ handleListRecent: vi.fn() }));
vi.mock('./tools/get-stats.js', () => ({ handleGetStats: vi.fn() }));
vi.mock('./tools/capture-memory.js', async () => {
  const actual = await vi.importActual<typeof import('./tools/capture-memory.js')>('./tools/capture-memory.js');
  return { ...actual, handleCaptureMemory: vi.fn() };
});

import { createServer, TOOL_NAMES } from './server.js';
import { handleSearchBrain } from './tools/search-brain.js';
import { handleListRecent } from './tools/list-recent.js';
import { handleGetStats } from './tools/get-stats.js';
import { handleCaptureMemory, CaptureValidationError, DbWriteError } from './tools/capture-memory.js';
import { RateLimiter } from './auth/rate-limiter.js';
import type { Env } from './env.js';

const mockHandleSearchBrain = vi.mocked(handleSearchBrain);
const mockHandleListRecent = vi.mocked(handleListRecent);
const mockHandleGetStats = vi.mocked(handleGetStats);
const mockHandleCaptureMemory = vi.mocked(handleCaptureMemory);

const FAKE_SQL = {} as import('open-brain-workers-shared').Db;
const FAKE_ENV: Env = {
  DATABASE_URL: 'postgres://test',
  MCP_CLIENT_SECRET: 'client-secret',
  CAPTURE_JWT_SECRET: 'jwt-secret',
  OPENAI_API_KEY: 'sk-test',
};

function getCallback(spy: ReturnType<typeof vi.spyOn>, toolName: string) {
  const call = spy.mock.calls.find((c) => c[0] === toolName);
  if (!call) throw new Error(`tool ${toolName} was not registered`);
  return call[2] as (params: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
}

describe('createServer', () => {
  it('registers exactly the 4 expected tools', () => {
    const registerSpy = vi.spyOn(McpServer.prototype, 'registerTool');
    const deps = { sql: FAKE_SQL, env: FAKE_ENV, captureLimiter: new RateLimiter({ windowMs: 60_000, maxRequests: 60 }) };

    createServer(deps);

    const registeredNames = registerSpy.mock.calls.map((c) => c[0]);
    expect(registeredNames).toEqual([...TOOL_NAMES]);
    registerSpy.mockRestore();
  });

  it('search_brain returns results on success and an error envelope on failure', async () => {
    const registerSpy = vi.spyOn(McpServer.prototype, 'registerTool');
    const deps = { sql: FAKE_SQL, env: FAKE_ENV, captureLimiter: new RateLimiter({ windowMs: 60_000, maxRequests: 60 }) };
    createServer(deps);
    const cb = getCallback(registerSpy, 'search_brain');
    registerSpy.mockRestore();

    mockHandleSearchBrain.mockResolvedValueOnce([]);
    const ok = await cb({ query: 'test' });
    expect(ok.isError).toBeFalsy();
    expect(JSON.parse(ok.content[0].text)).toEqual([]);

    mockHandleSearchBrain.mockRejectedValueOnce(new Error('boom'));
    const failed = await cb({ query: 'test' });
    expect(failed.isError).toBe(true);
    expect(JSON.parse(failed.content[0].text).error).toBe('SEARCH_FAILED');
  });

  it('list_recent returns results on success and an error envelope on failure', async () => {
    const registerSpy = vi.spyOn(McpServer.prototype, 'registerTool');
    const deps = { sql: FAKE_SQL, env: FAKE_ENV, captureLimiter: new RateLimiter({ windowMs: 60_000, maxRequests: 60 }) };
    createServer(deps);
    const cb = getCallback(registerSpy, 'list_recent');
    registerSpy.mockRestore();

    mockHandleListRecent.mockResolvedValueOnce([]);
    const ok = await cb({});
    expect(ok.isError).toBeFalsy();

    mockHandleListRecent.mockRejectedValueOnce(new Error('boom'));
    const failed = await cb({});
    expect(failed.isError).toBe(true);
    expect(JSON.parse(failed.content[0].text).error).toBe('LIST_FAILED');
  });

  it('get_stats returns stats on success and an error envelope on failure', async () => {
    const registerSpy = vi.spyOn(McpServer.prototype, 'registerTool');
    const deps = { sql: FAKE_SQL, env: FAKE_ENV, captureLimiter: new RateLimiter({ windowMs: 60_000, maxRequests: 60 }) };
    createServer(deps);
    const cb = getCallback(registerSpy, 'get_stats');
    registerSpy.mockRestore();

    mockHandleGetStats.mockResolvedValueOnce({
      total_memories: 0,
      last_7_days: 0,
      last_30_days: 0,
      by_type: {},
      by_embedding_status: { ready: 0, pending: 0, failed: 0 },
      embedding_model: 'text-embedding-3-small',
      top_topics: [],
    });
    const ok = await cb({});
    expect(ok.isError).toBeFalsy();

    mockHandleGetStats.mockRejectedValueOnce(new Error('boom'));
    const failed = await cb({});
    expect(failed.isError).toBe(true);
    expect(JSON.parse(failed.content[0].text).error).toBe('STATS_FAILED');
  });

  describe('capture_memory', () => {
    it('returns the capture result on success', async () => {
      const registerSpy = vi.spyOn(McpServer.prototype, 'registerTool');
      const deps = { sql: FAKE_SQL, env: FAKE_ENV, captureLimiter: new RateLimiter({ windowMs: 60_000, maxRequests: 60 }) };
      createServer(deps);
      const cb = getCallback(registerSpy, 'capture_memory');
      registerSpy.mockRestore();

      mockHandleCaptureMemory.mockResolvedValueOnce({
        id: 'mem-1',
        captured_at: '2026-01-01T00:00:00.000Z',
        source: 'mcp_direct',
        embedding_status: 'ready',
        metadata_status: 'ready',
        metadata: { type: 'insight', topics: [], people: [], action_items: [], confidence: 0.8, truncated: false },
      });

      const result = await cb({ text: 'hello' });
      expect(result.isError).toBeFalsy();
    });

    it('is rate limited after the capture limit is exceeded', async () => {
      const registerSpy = vi.spyOn(McpServer.prototype, 'registerTool');
      const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });
      const deps = { sql: FAKE_SQL, env: FAKE_ENV, captureLimiter: limiter };
      createServer(deps);
      const cb = getCallback(registerSpy, 'capture_memory');
      registerSpy.mockRestore();

      mockHandleCaptureMemory.mockResolvedValue({
        id: 'mem-1',
        captured_at: '2026-01-01T00:00:00.000Z',
        source: 'mcp_direct',
        embedding_status: 'ready',
        metadata_status: 'ready',
        metadata: { type: 'insight', topics: [], people: [], action_items: [], confidence: 0.8, truncated: false },
      });

      await cb({ text: 'first' });
      const second = await cb({ text: 'second' });

      expect(second.isError).toBe(true);
      expect(JSON.parse(second.content[0].text).error).toBe('RATE_LIMITED');
    });

    it('maps CaptureValidationError to its error code', async () => {
      const registerSpy = vi.spyOn(McpServer.prototype, 'registerTool');
      const deps = { sql: FAKE_SQL, env: FAKE_ENV, captureLimiter: new RateLimiter({ windowMs: 60_000, maxRequests: 60 }) };
      createServer(deps);
      const cb = getCallback(registerSpy, 'capture_memory');
      registerSpy.mockRestore();

      mockHandleCaptureMemory.mockRejectedValueOnce(new CaptureValidationError('INVALID_TEXT', 'bad text'));
      const result = await cb({ text: '' });

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toBe('INVALID_TEXT');
    });

    it('maps DbWriteError to DB_WRITE_FAILED', async () => {
      const registerSpy = vi.spyOn(McpServer.prototype, 'registerTool');
      const deps = { sql: FAKE_SQL, env: FAKE_ENV, captureLimiter: new RateLimiter({ windowMs: 60_000, maxRequests: 60 }) };
      createServer(deps);
      const cb = getCallback(registerSpy, 'capture_memory');
      registerSpy.mockRestore();

      mockHandleCaptureMemory.mockRejectedValueOnce(new DbWriteError('connection refused'));
      const result = await cb({ text: 'hello' });

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toBe('DB_WRITE_FAILED');
    });

    it('rethrows unexpected errors', async () => {
      const registerSpy = vi.spyOn(McpServer.prototype, 'registerTool');
      const deps = { sql: FAKE_SQL, env: FAKE_ENV, captureLimiter: new RateLimiter({ windowMs: 60_000, maxRequests: 60 }) };
      createServer(deps);
      const cb = getCallback(registerSpy, 'capture_memory');
      registerSpy.mockRestore();

      mockHandleCaptureMemory.mockRejectedValueOnce(new Error('unexpected'));
      await expect(cb({ text: 'hello' })).rejects.toThrow('unexpected');
    });
  });
});
