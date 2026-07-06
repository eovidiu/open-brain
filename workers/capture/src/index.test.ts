import type { CaptureResult } from 'open-brain-workers-shared';
import type { Env } from './env.js';

const mockCreateDb = vi.fn();
const mockInsertMemory = vi.fn();
const mockFetchEmbedding = vi.fn();
const mockExtractMetadata = vi.fn();

vi.mock('open-brain-workers-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('open-brain-workers-shared')>();
  return {
    ...actual,
    createDb: mockCreateDb,
    insertMemory: mockInsertMemory,
    fetchEmbedding: mockFetchEmbedding,
    extractMetadata: mockExtractMetadata,
  };
});

const worker = (await import('./index.js')).default;
const { resetRateLimit } = await import('./rate-limit.js');

const ENV: Env = {
  DATABASE_URL: 'postgres://test-db',
  CAPTURE_JWT_SECRET: 'jwt-secret-value',
  CAPTURE_WEBHOOK_SECRET: 'webhook-secret-value',
  OPENAI_API_KEY: 'sk-test',
};

const GOOD_METADATA = {
  type: 'insight' as const,
  topics: ['worker'],
  people: [],
  action_items: [],
  confidence: 0.9,
  truncated: false,
};

const FAKE_EMBEDDING = [0.1, 0.2, 0.3];

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signJwt(secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ sub: 'open-brain-owner', iat: now, exp: now + 3600 })),
  );
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput)));
  return `${signingInput}.${base64UrlEncode(sig)}`;
}

async function signHmacBody(body: string, secret: string, timestamp: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)),
  );
  return `sha256=${Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

async function jwtRequest(body: string): Promise<Request> {
  const token = await signJwt(ENV.CAPTURE_JWT_SECRET);
  return new Request('https://worker.example/capture', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
  });
}

function mockDbResult(overrides: Partial<CaptureResult> = {}): CaptureResult {
  return {
    id: 'mem-1',
    captured_at: '2026-07-04T00:00:00.000Z',
    source: 'api',
    embedding_status: 'ready',
    metadata_status: 'ready',
    metadata: GOOD_METADATA,
    ...overrides,
  };
}

beforeEach(() => {
  resetRateLimit();
  mockCreateDb.mockReset().mockReturnValue('fake-sql-handle');
  mockInsertMemory.mockReset().mockResolvedValue(mockDbResult());
  mockFetchEmbedding.mockReset().mockResolvedValue(FAKE_EMBEDDING);
  mockExtractMetadata.mockReset().mockResolvedValue(GOOD_METADATA);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('capture worker', () => {
  it('returns 201 with the memory id for a validly signed JWT request', async () => {
    const req = await jwtRequest(JSON.stringify({ text: 'hello world', source: 'api' }));

    const res = await worker.fetch(req, ENV);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe('mem-1');
    expect(mockInsertMemory).toHaveBeenCalledWith(
      'fake-sql-handle',
      expect.objectContaining({ raw_text: 'hello world', source: 'api' }),
    );
  });

  it('returns 201 with the memory id for a validly signed HMAC request', async () => {
    const bodyStr = JSON.stringify({ text: 'hello from a webhook', source: 'slack' });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = await signHmacBody(bodyStr, ENV.CAPTURE_WEBHOOK_SECRET, timestamp);

    const req = new Request('https://worker.example/capture', {
      method: 'POST',
      headers: { 'X-OpenBrain-Signature': sig, 'X-OpenBrain-Timestamp': timestamp },
      body: bodyStr,
    });

    const res = await worker.fetch(req, ENV);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe('mem-1');
  });

  it('returns 401 when no auth is provided', async () => {
    const req = new Request('https://worker.example/capture', {
      method: 'POST',
      body: JSON.stringify({ text: 'hello' }),
    });

    const res = await worker.fetch(req, ENV);

    expect(res.status).toBe(401);
    expect(mockInsertMemory).not.toHaveBeenCalled();
  });

  it('returns 401 for an invalid JWT', async () => {
    const req = new Request('https://worker.example/capture', {
      method: 'POST',
      headers: { Authorization: 'Bearer not-a-real-token' },
      body: JSON.stringify({ text: 'hello' }),
    });

    const res = await worker.fetch(req, ENV);

    expect(res.status).toBe(401);
  });

  it('returns 401 for an invalid HMAC signature', async () => {
    const req = new Request('https://worker.example/capture', {
      method: 'POST',
      headers: {
        'X-OpenBrain-Signature': 'sha256=deadbeef',
        'X-OpenBrain-Timestamp': String(Math.floor(Date.now() / 1000)),
      },
      body: JSON.stringify({ text: 'hello' }),
    });

    const res = await worker.fetch(req, ENV);

    expect(res.status).toBe(401);
  });

  it('returns 400 INVALID_TEXT for empty text', async () => {
    const req = await jwtRequest(JSON.stringify({ text: '' }));
    const res = await worker.fetch(req, ENV);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('INVALID_TEXT');
  });

  it('returns 400 INVALID_TEXT for text over the length limit', async () => {
    const req = await jwtRequest(JSON.stringify({ text: 'a'.repeat(10_001) }));
    const res = await worker.fetch(req, ENV);

    expect(res.status).toBe(400);
  });

  it('returns 400 INVALID_TEXT for unparseable JSON', async () => {
    const req = await jwtRequest('not json');
    const res = await worker.fetch(req, ENV);

    expect(res.status).toBe(400);
  });

  it('returns 400 INVALID_SOURCE for an unrecognized source', async () => {
    const req = await jwtRequest(JSON.stringify({ text: 'hello', source: 'twitter' }));
    const res = await worker.fetch(req, ENV);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('INVALID_SOURCE');
  });

  it('defaults source to api when omitted', async () => {
    const req = await jwtRequest(JSON.stringify({ text: 'hello' }));
    await worker.fetch(req, ENV);

    expect(mockInsertMemory).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: 'api' }),
    );
  });

  it('stores embedding_status pending when embedding generation fails', async () => {
    mockFetchEmbedding.mockResolvedValue(null);

    const req = await jwtRequest(JSON.stringify({ text: 'hello' }));
    await worker.fetch(req, ENV);

    expect(mockInsertMemory).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ embedding: null, embedding_status: 'pending' }),
    );
  });

  it('stores metadata_status degraded when metadata extraction fails', async () => {
    mockExtractMetadata.mockResolvedValue(null);

    const req = await jwtRequest(JSON.stringify({ text: 'hello' }));
    await worker.fetch(req, ENV);

    expect(mockInsertMemory).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ metadata_status: 'degraded' }),
    );
  });

  it('stores embedding_status pending when embedding generation throws', async () => {
    mockFetchEmbedding.mockRejectedValue(new Error('OpenAI down'));

    const req = await jwtRequest(JSON.stringify({ text: 'hello' }));
    await worker.fetch(req, ENV);

    expect(mockInsertMemory).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ embedding: null, embedding_status: 'pending' }),
    );
  });

  it('stores metadata_status degraded when metadata extraction throws', async () => {
    mockExtractMetadata.mockRejectedValue(new Error('LLM down'));

    const req = await jwtRequest(JSON.stringify({ text: 'hello' }));
    await worker.fetch(req, ENV);

    expect(mockInsertMemory).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ metadata_status: 'degraded' }),
    );
  });

  it('returns 405 for non-POST, non-OPTIONS methods', async () => {
    const req = new Request('https://worker.example/capture', { method: 'GET' });
    const res = await worker.fetch(req, ENV);

    expect(res.status).toBe(405);
  });

  it('returns 204 with no wildcard CORS origin on OPTIONS preflight', async () => {
    const req = new Request('https://worker.example/capture', { method: 'OPTIONS' });
    const res = await worker.fetch(req, ENV);

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
  });

  it('never sends a wildcard CORS origin on any response', async () => {
    const req = await jwtRequest(JSON.stringify({ text: 'hello' }));
    const res = await worker.fetch(req, ENV);

    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
  });

  it('returns 500 DB_WRITE_FAILED when the insert throws', async () => {
    mockInsertMemory.mockRejectedValue(new Error('connection refused'));

    const req = await jwtRequest(JSON.stringify({ text: 'hello' }));
    const res = await worker.fetch(req, ENV);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('DB_WRITE_FAILED');
  });

  it('returns 500 DB_WRITE_FAILED when DATABASE_URL is not configured', async () => {
    const req = await jwtRequest(JSON.stringify({ text: 'hello' }));
    const res = await worker.fetch(req, { ...ENV, DATABASE_URL: '' });

    expect(res.status).toBe(500);
    expect(mockCreateDb).not.toHaveBeenCalled();
  });

  it('rate limits after 60 requests from the same credential', async () => {
    for (let i = 0; i < 60; i++) {
      const req = await jwtRequest(JSON.stringify({ text: `hello ${i}` }));
      const res = await worker.fetch(req, ENV);
      expect(res.status).toBe(201);
    }

    const req = await jwtRequest(JSON.stringify({ text: 'one too many' }));
    const res = await worker.fetch(req, ENV);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });
});
