vi.mock('agents/mcp', () => ({ createMcpHandler: vi.fn() }));
vi.mock('open-brain-workers-shared', async () => {
  const actual = await vi.importActual<typeof import('open-brain-workers-shared')>('open-brain-workers-shared');
  return {
    ...actual,
    createDb: vi.fn(() => vi.fn().mockResolvedValue([{ count: 5 }])),
    getSystemConfig: vi.fn(),
    authenticateApiKey: vi.fn(),
    touchApiKey: vi.fn(),
  };
});

import worker from './index.js';
import { createMcpHandler } from 'agents/mcp';
import {
  authenticateApiKey,
  createDb,
  getSystemConfig,
  touchApiKey,
  type ApiKeyRecord,
} from 'open-brain-workers-shared';
import type { Env } from './env.js';

const mockCreateMcpHandler = vi.mocked(createMcpHandler);
const mockGetSystemConfig = vi.mocked(getSystemConfig);
const mockAuthenticateApiKey = vi.mocked(authenticateApiKey);
const mockTouchApiKey = vi.mocked(touchApiKey);

const PRESENTED_VALUE = 'obk_value-the-worker-looks-up';

const FAKE_ENV: Env = {
  DATABASE_URL: 'postgres://test',
  OPENAI_API_KEY: 'sk-test',
};

const LIVE_KEY: ApiKeyRecord = {
  id: 'key-1',
  label: 'laptop',
  created_at: '2026-08-08T00:00:00.000Z',
  last_used_at: null,
  revoked_at: null,
};

function ctx(): ExecutionContext {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
}

// Each test gets a distinct IP so the shared module-level rate limiter does
// not leak budget between cases.
let ipCounter = 0;
function req(path: string, init?: RequestInit): Request {
  ipCounter += 1;
  return new Request(`https://mcp.example.com${path}`, {
    ...init,
    headers: { 'CF-Connecting-IP': `10.0.0.${ipCounter}`, ...(init?.headers ?? {}) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('removed /auth/token endpoint', () => {
  it('returns 404 for POST', async () => {
    const res = await worker.fetch(
      req('/auth/token', { method: 'POST', body: JSON.stringify({ client_secret: 'anything' }) }),
      FAKE_ENV,
      ctx(),
    );

    expect(res.status).toBe(404);
    expect(mockAuthenticateApiKey).not.toHaveBeenCalled();
  });

  it('returns 404 for GET', async () => {
    const res = await worker.fetch(req('/auth/token'), FAKE_ENV, ctx());
    expect(res.status).toBe(404);
  });

  it('does not fall through to the MCP handler', async () => {
    await worker.fetch(req('/auth/token', { method: 'POST' }), FAKE_ENV, ctx());
    expect(mockCreateMcpHandler).not.toHaveBeenCalled();
  });
});

describe('GET /health', () => {
  it('returns ok with db stats when the DB is reachable', async () => {
    mockGetSystemConfig.mockResolvedValue({
      id: 1,
      embedding_model: 'text-embedding-3-small',
      embedding_dimensions: 1536,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    const res = await worker.fetch(req('/health'), FAKE_ENV, ctx());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; db_connected: boolean; total_memories: number };
    expect(body.status).toBe('ok');
    expect(body.db_connected).toBe(true);
    expect(body.total_memories).toBe(5);
  });

  it('returns degraded when the DB check fails', async () => {
    mockGetSystemConfig.mockRejectedValue(new Error('connection refused'));

    const res = await worker.fetch(req('/health'), FAKE_ENV, ctx());

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; db_connected: boolean };
    expect(body.status).toBe('degraded');
    expect(body.db_connected).toBe(false);
  });

  it('reports zero memories when the count query comes back empty', async () => {
    mockGetSystemConfig.mockResolvedValue({
      id: 1,
      embedding_model: 'text-embedding-3-small',
      embedding_dimensions: 1536,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(createDb).mockReturnValueOnce(
      vi.fn().mockResolvedValue([]) as unknown as ReturnType<typeof createDb>,
    );

    const res = await worker.fetch(req('/health'), FAKE_ENV, ctx());

    expect(((await res.json()) as { total_memories: number }).total_memories).toBe(0);
  });

  it('degrades gracefully when the DB rejects with a non-Error', async () => {
    mockGetSystemConfig.mockRejectedValue('connection reset');

    const res = await worker.fetch(req('/health'), FAKE_ENV, ctx());

    expect(res.status).toBe(503);
  });

  it('needs no credential', async () => {
    mockGetSystemConfig.mockResolvedValue({
      id: 1,
      embedding_model: 'text-embedding-3-small',
      embedding_dimensions: 1536,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    const res = await worker.fetch(req('/health'), FAKE_ENV, ctx());

    expect(res.status).toBe(200);
    expect(mockAuthenticateApiKey).not.toHaveBeenCalled();
  });
});

describe('MCP endpoint API-key gate', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = await worker.fetch(req('/mcp'), FAKE_ENV, ctx());

    expect(res.status).toBe(401);
    expect(mockCreateMcpHandler).not.toHaveBeenCalled();
  });

  it('rejects a malformed Authorization header', async () => {
    const res = await worker.fetch(
      req('/mcp', { headers: { Authorization: 'Basic abc123' } }),
      FAKE_ENV,
      ctx(),
    );

    expect(res.status).toBe(401);
    expect(mockAuthenticateApiKey).not.toHaveBeenCalled();
  });

  it('rejects a Bearer header with an empty key', async () => {
    const res = await worker.fetch(
      req('/mcp', { headers: { Authorization: 'Bearer ' } }),
      FAKE_ENV,
      ctx(),
    );

    expect(res.status).toBe(401);
  });

  it('rejects an unknown key', async () => {
    mockAuthenticateApiKey.mockResolvedValue(null);

    const res = await worker.fetch(
      req('/mcp', { headers: { Authorization: `Bearer ${PRESENTED_VALUE}` } }),
      FAKE_ENV,
      ctx(),
    );

    expect(res.status).toBe(401);
    expect(mockCreateMcpHandler).not.toHaveBeenCalled();
  });

  it('rejects a revoked key indistinguishably from an unknown one', async () => {
    mockAuthenticateApiKey.mockResolvedValue(null);

    const revoked = await worker.fetch(
      req('/mcp', { headers: { Authorization: `Bearer ${PRESENTED_VALUE}` } }),
      FAKE_ENV,
      ctx(),
    );
    const unknown = await worker.fetch(
      req('/mcp', { headers: { Authorization: 'Bearer obk_some-other-key' } }),
      FAKE_ENV,
      ctx(),
    );

    expect(revoked.status).toBe(unknown.status);
    expect(await revoked.text()).toBe(await unknown.text());
  });

  it('accepts a live key and delegates to createMcpHandler', async () => {
    mockAuthenticateApiKey.mockResolvedValue(LIVE_KEY);
    const delegatedResponse = new Response('ok', { status: 200 });
    const innerHandler = vi.fn().mockResolvedValue(delegatedResponse);
    mockCreateMcpHandler.mockReturnValue(innerHandler);

    const res = await worker.fetch(
      req('/mcp', { headers: { Authorization: `Bearer ${PRESENTED_VALUE}` } }),
      FAKE_ENV,
      ctx(),
    );

    expect(mockAuthenticateApiKey).toHaveBeenCalledWith(expect.anything(), PRESENTED_VALUE);
    expect(mockCreateMcpHandler).toHaveBeenCalledTimes(1);
    expect(res).toBe(delegatedResponse);
  });

  it('carries no expiry — the same key authenticates repeatedly', async () => {
    mockAuthenticateApiKey.mockResolvedValue(LIVE_KEY);
    mockCreateMcpHandler.mockReturnValue(vi.fn().mockResolvedValue(new Response('ok')));

    for (let i = 0; i < 3; i++) {
      const res = await worker.fetch(
        req('/mcp', { headers: { Authorization: `Bearer ${PRESENTED_VALUE}` } }),
        FAKE_ENV,
        ctx(),
      );
      expect(res.status).toBe(200);
    }
  });

  it('records last_used_at off the critical path via waitUntil', async () => {
    mockAuthenticateApiKey.mockResolvedValue(LIVE_KEY);
    mockCreateMcpHandler.mockReturnValue(vi.fn().mockResolvedValue(new Response('ok')));
    const executionCtx = ctx();

    await worker.fetch(
      req('/mcp', { headers: { Authorization: `Bearer ${PRESENTED_VALUE}` } }),
      FAKE_ENV,
      executionCtx,
    );

    expect(executionCtx.waitUntil).toHaveBeenCalledTimes(1);
    expect(mockTouchApiKey).toHaveBeenCalledWith(expect.anything(), LIVE_KEY.id);
  });

  it('does not record last_used_at for a rejected key', async () => {
    mockAuthenticateApiKey.mockResolvedValue(null);
    const executionCtx = ctx();

    await worker.fetch(
      req('/mcp', { headers: { Authorization: `Bearer ${PRESENTED_VALUE}` } }),
      FAKE_ENV,
      executionCtx,
    );

    expect(mockTouchApiKey).not.toHaveBeenCalled();
    expect(executionCtx.waitUntil).not.toHaveBeenCalled();
  });

  it('returns 503 when the key lookup fails, without leaking the key', async () => {
    mockAuthenticateApiKey.mockRejectedValue(new Error('Database operation failed: authenticate api key'));

    const res = await worker.fetch(
      req('/mcp', { headers: { Authorization: `Bearer ${PRESENTED_VALUE}` } }),
      FAKE_ENV,
      ctx(),
    );

    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain(PRESENTED_VALUE);
  });
});

describe('no key material in responses', () => {
  it('omits the presented key from a 401 body', async () => {
    mockAuthenticateApiKey.mockResolvedValue(null);

    const res = await worker.fetch(
      req('/mcp', { headers: { Authorization: `Bearer ${PRESENTED_VALUE}` } }),
      FAKE_ENV,
      ctx(),
    );

    const text = await res.text();
    expect(text).not.toContain(PRESENTED_VALUE);
    expect(text).not.toContain('obk_');
  });

  it('never logs the presented key', async () => {
    mockAuthenticateApiKey.mockResolvedValue(null);
    const errorSpy = vi.spyOn(console, 'error');

    await worker.fetch(
      req('/mcp', { headers: { Authorization: `Bearer ${PRESENTED_VALUE}` } }),
      FAKE_ENV,
      ctx(),
    );

    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).not.toContain(PRESENTED_VALUE);
  });
});

describe('rate limiting on the MCP endpoint', () => {
  it('returns 429 after repeated unauthenticated requests from one IP', async () => {
    mockAuthenticateApiKey.mockResolvedValue(null);
    const headers = { 'CF-Connecting-IP': '203.0.113.7' };

    for (let i = 0; i < 5; i++) {
      const res = await worker.fetch(
        new Request('https://mcp.example.com/mcp', { headers }),
        FAKE_ENV,
        ctx(),
      );
      expect(res.status).toBe(401);
    }

    const limited = await worker.fetch(
      new Request('https://mcp.example.com/mcp', { headers }),
      FAKE_ENV,
      ctx(),
    );

    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBeTruthy();
  });

  it('checks the limit before touching the database', async () => {
    mockAuthenticateApiKey.mockResolvedValue(null);
    const headers = {
      'CF-Connecting-IP': '203.0.113.8',
      Authorization: `Bearer ${PRESENTED_VALUE}`,
    };

    for (let i = 0; i < 5; i++) {
      await worker.fetch(new Request('https://mcp.example.com/mcp', { headers }), FAKE_ENV, ctx());
    }
    mockAuthenticateApiKey.mockClear();

    const limited = await worker.fetch(
      new Request('https://mcp.example.com/mcp', { headers }),
      FAKE_ENV,
      ctx(),
    );

    expect(limited.status).toBe(429);
    expect(mockAuthenticateApiKey).not.toHaveBeenCalled();
  });

  it('does not spend budget on successful requests', async () => {
    mockAuthenticateApiKey.mockResolvedValue(LIVE_KEY);
    mockCreateMcpHandler.mockReturnValue(vi.fn().mockResolvedValue(new Response('ok')));
    const headers = {
      'CF-Connecting-IP': '203.0.113.9',
      Authorization: `Bearer ${PRESENTED_VALUE}`,
    };

    for (let i = 0; i < 20; i++) {
      const res = await worker.fetch(
        new Request('https://mcp.example.com/mcp', { headers }),
        FAKE_ENV,
        ctx(),
      );
      expect(res.status).toBe(200);
    }
  });

  it('falls back to a shared bucket when CF-Connecting-IP is absent', async () => {
    mockAuthenticateApiKey.mockResolvedValue(null);

    for (let i = 0; i < 5; i++) {
      const res = await worker.fetch(new Request('https://mcp.example.com/mcp'), FAKE_ENV, ctx());
      expect(res.status).toBe(401);
    }

    const limited = await worker.fetch(new Request('https://mcp.example.com/mcp'), FAKE_ENV, ctx());
    expect(limited.status).toBe(429);
  });

  it('tracks IPs independently', async () => {
    mockAuthenticateApiKey.mockResolvedValue(null);

    for (let i = 0; i < 6; i++) {
      await worker.fetch(
        new Request('https://mcp.example.com/mcp', { headers: { 'CF-Connecting-IP': '198.51.100.1' } }),
        FAKE_ENV,
        ctx(),
      );
    }

    const other = await worker.fetch(
      new Request('https://mcp.example.com/mcp', { headers: { 'CF-Connecting-IP': '198.51.100.2' } }),
      FAKE_ENV,
      ctx(),
    );

    expect(other.status).toBe(401);
  });
});
