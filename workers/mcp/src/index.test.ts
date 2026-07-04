vi.mock('agents/mcp', () => ({ createMcpHandler: vi.fn() }));
vi.mock('open-brain-workers-shared', async () => {
  const actual = await vi.importActual<typeof import('open-brain-workers-shared')>('open-brain-workers-shared');
  return { ...actual, createDb: vi.fn(() => vi.fn().mockResolvedValue([{ count: 5 }])) };
});
vi.mock('./db.js', async () => {
  const actual = await vi.importActual<typeof import('./db.js')>('./db.js');
  return { ...actual, getSystemConfig: vi.fn() };
});

import worker from './index.js';
import { createMcpHandler } from 'agents/mcp';
import { getSystemConfig } from './db.js';
import { signToken } from './auth/jwt.js';
import type { Env } from './env.js';

const mockCreateMcpHandler = vi.mocked(createMcpHandler);
const mockGetSystemConfig = vi.mocked(getSystemConfig);

const FAKE_ENV: Env = {
  DATABASE_URL: 'postgres://test',
  MCP_CLIENT_SECRET: 'client-secret',
  CAPTURE_JWT_SECRET: 'jwt-secret',
  OPENAI_API_KEY: 'sk-test',
};

const FAKE_CTX = {} as ExecutionContext;

function req(path: string, init?: RequestInit): Request {
  return new Request(`https://mcp.example.com${path}`, init);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /auth/token', () => {
  it('returns 400 when client_secret is missing', async () => {
    const res = await worker.fetch(
      req('/auth/token', { method: 'POST', body: JSON.stringify({}) }),
      FAKE_ENV,
      FAKE_CTX,
    );
    expect(res.status).toBe(400);
  });

  it('returns 401 when client_secret is wrong', async () => {
    const res = await worker.fetch(
      req('/auth/token', { method: 'POST', body: JSON.stringify({ client_secret: 'nope' }) }),
      FAKE_ENV,
      FAKE_CTX,
    );
    expect(res.status).toBe(401);
  });

  it('returns a signed token when client_secret is correct', async () => {
    const res = await worker.fetch(
      req('/auth/token', { method: 'POST', body: JSON.stringify({ client_secret: 'client-secret' }) }),
      FAKE_ENV,
      FAKE_CTX,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expires_in: number; token_type: string };
    expect(typeof body.token).toBe('string');
    expect(body.expires_in).toBe(3600);
    expect(body.token_type).toBe('Bearer');
  });

  it('returns 429 after the auth rate limit is exceeded', async () => {
    for (let i = 0; i < 5; i++) {
      await worker.fetch(
        req('/auth/token', {
          method: 'POST',
          headers: { 'CF-Connecting-IP': '1.2.3.4' },
          body: JSON.stringify({ client_secret: 'wrong' }),
        }),
        FAKE_ENV,
        FAKE_CTX,
      );
    }
    const res = await worker.fetch(
      req('/auth/token', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
        body: JSON.stringify({ client_secret: 'wrong' }),
      }),
      FAKE_ENV,
      FAKE_CTX,
    );
    expect(res.status).toBe(429);
  });

  it('returns 400 for a malformed JSON body', async () => {
    const res = await worker.fetch(
      req('/auth/token', { method: 'POST', headers: { 'CF-Connecting-IP': '5.5.5.5' }, body: '{not json' }),
      FAKE_ENV,
      FAKE_CTX,
    );
    expect(res.status).toBe(400);
  });

  it('returns 500 when CAPTURE_JWT_SECRET is not configured at issuance time', async () => {
    const res = await worker.fetch(
      req('/auth/token', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '6.6.6.6' },
        body: JSON.stringify({ client_secret: 'client-secret' }),
      }),
      { ...FAKE_ENV, CAPTURE_JWT_SECRET: '' },
      FAKE_CTX,
    );
    expect(res.status).toBe(500);
  });

  it('returns 500 when MCP_CLIENT_SECRET is not configured', async () => {
    const res = await worker.fetch(
      req('/auth/token', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '9.9.9.9' },
        body: JSON.stringify({ client_secret: 'anything' }),
      }),
      { ...FAKE_ENV, MCP_CLIENT_SECRET: '' },
      FAKE_CTX,
    );
    expect(res.status).toBe(500);
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

    const res = await worker.fetch(req('/health'), FAKE_ENV, FAKE_CTX);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; db_connected: boolean; total_memories: number };
    expect(body.status).toBe('ok');
    expect(body.db_connected).toBe(true);
    expect(body.total_memories).toBe(5);
  });

  it('returns degraded when the DB check fails', async () => {
    mockGetSystemConfig.mockRejectedValue(new Error('connection refused'));

    const res = await worker.fetch(req('/health'), FAKE_ENV, FAKE_CTX);

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; db_connected: boolean };
    expect(body.status).toBe('degraded');
    expect(body.db_connected).toBe(false);
  });
});

describe('MCP endpoint auth gate', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = await worker.fetch(req('/'), FAKE_ENV, FAKE_CTX);
    expect(res.status).toBe(401);
    expect(mockCreateMcpHandler).not.toHaveBeenCalled();
  });

  it('rejects a request with an invalid JWT', async () => {
    const res = await worker.fetch(
      req('/', { headers: { Authorization: 'Bearer not-a-real-token' } }),
      FAKE_ENV,
      FAKE_CTX,
    );
    expect(res.status).toBe(401);
    expect(mockCreateMcpHandler).not.toHaveBeenCalled();
  });

  it('accepts a valid JWT and delegates to createMcpHandler', async () => {
    const { token } = await signToken(FAKE_ENV.CAPTURE_JWT_SECRET);
    const delegatedResponse = new Response('ok', { status: 200 });
    const innerHandler = vi.fn().mockResolvedValue(delegatedResponse);
    mockCreateMcpHandler.mockReturnValue(innerHandler);

    const res = await worker.fetch(
      req('/', { headers: { Authorization: `Bearer ${token}` } }),
      FAKE_ENV,
      FAKE_CTX,
    );

    expect(mockCreateMcpHandler).toHaveBeenCalledTimes(1);
    expect(innerHandler).toHaveBeenCalledTimes(1);
    expect(res).toBe(delegatedResponse);
  });

  it('returns 500 when CAPTURE_JWT_SECRET is not configured', async () => {
    const res = await worker.fetch(
      req('/', { headers: { Authorization: 'Bearer whatever' } }),
      { ...FAKE_ENV, CAPTURE_JWT_SECRET: '' },
      FAKE_CTX,
    );
    expect(res.status).toBe(500);
  });
});
