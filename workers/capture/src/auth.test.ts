import { authenticate, verifyHmacSignature } from './auth.js';
import type { Db } from 'open-brain-workers-shared';

const WEBHOOK_SECRET = 'webhook-secret-value';

// A syntactically valid key that is not, and never was, a credential: the
// tests below stub the database, so nothing here is ever hashed against a
// real row.
const PRESENTED_KEY = 'obk_not-a-key';

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

// authenticateApiKey looks the presented key up by its SHA-256, so the stub
// must echo back the same hash it was queried with for the constant-time
// comparison to succeed.
function stubDb(overrides: Record<string, unknown> = {}): Db {
  return ((_strings: readonly string[], ...params: unknown[]) =>
    Promise.resolve([
      {
        id: 'key-1',
        label: 'laptop',
        key_hash: params[0],
        created_at: new Date('2026-08-08T00:00:00.000Z'),
        last_used_at: null,
        revoked_at: null,
        ...overrides,
      },
    ])) as unknown as Db;
}

function emptyDb(): Db {
  return (() => Promise.resolve([])) as unknown as Db;
}

function failingDb(): Db {
  return (() => Promise.reject(new Error('connection refused'))) as unknown as Db;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('verifyHmacSignature', () => {
  const body = new TextEncoder().encode('{"text":"hello"}');
  const bodyStr = '{"text":"hello"}';

  it('accepts a valid signature over timestamp.body within the window', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = await signHmacBody(bodyStr, WEBHOOK_SECRET, timestamp);
    expect(await verifyHmacSignature(body, sig, WEBHOOK_SECRET, timestamp)).toBe(true);
  });

  it('rejects a timestamp older than 5 minutes', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000) - 301);
    const sig = await signHmacBody(bodyStr, WEBHOOK_SECRET, timestamp);
    expect(await verifyHmacSignature(body, sig, WEBHOOK_SECRET, timestamp)).toBe(false);
  });

  it('rejects a timestamp more than 5 minutes in the future', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000) + 301);
    const sig = await signHmacBody(bodyStr, WEBHOOK_SECRET, timestamp);
    expect(await verifyHmacSignature(body, sig, WEBHOOK_SECRET, timestamp)).toBe(false);
  });

  it('rejects a missing timestamp', async () => {
    const sig = await signHmacBody(bodyStr, WEBHOOK_SECRET, '0');
    expect(await verifyHmacSignature(body, sig, WEBHOOK_SECRET, null)).toBe(false);
  });

  it('rejects a non-numeric timestamp', async () => {
    const sig = await signHmacBody(bodyStr, WEBHOOK_SECRET, 'not-a-number');
    expect(await verifyHmacSignature(body, sig, WEBHOOK_SECRET, 'not-a-number')).toBe(false);
  });

  it('rejects a signature missing the sha256= prefix', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(await verifyHmacSignature(body, 'deadbeef', WEBHOOK_SECRET, timestamp)).toBe(false);
  });

  it('rejects the wrong secret', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = await signHmacBody(bodyStr, 'wrong-secret', timestamp);
    expect(await verifyHmacSignature(body, sig, WEBHOOK_SECRET, timestamp)).toBe(false);
  });

  it('rejects a tampered body', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = await signHmacBody(bodyStr, WEBHOOK_SECRET, timestamp);
    const tamperedBody = new TextEncoder().encode('{"text":"tampered"}');
    expect(await verifyHmacSignature(tamperedBody, sig, WEBHOOK_SECRET, timestamp)).toBe(false);
  });
});

describe('authenticate', () => {
  it('authenticates a live API key and reports its id and label', async () => {
    const headers = new Headers({ Authorization: `Bearer ${PRESENTED_KEY}` });
    const result = await authenticate(headers, new Uint8Array(), {
      sql: stubDb(),
      webhookSecret: WEBHOOK_SECRET,
    });
    expect(result).toEqual({ authenticated: true, identifier: 'key:laptop', apiKeyId: 'key-1' });
  });

  it('rejects an unknown API key', async () => {
    const headers = new Headers({ Authorization: `Bearer ${PRESENTED_KEY}` });
    const result = await authenticate(headers, new Uint8Array(), {
      sql: emptyDb(),
      webhookSecret: WEBHOOK_SECRET,
    });
    expect(result).toEqual({ authenticated: false });
  });

  it('rejects a revoked API key', async () => {
    const headers = new Headers({ Authorization: `Bearer ${PRESENTED_KEY}` });
    const result = await authenticate(headers, new Uint8Array(), {
      sql: stubDb({ revoked_at: new Date('2026-08-09T00:00:00.000Z') }),
      webhookSecret: WEBHOOK_SECRET,
    });
    expect(result).toEqual({ authenticated: false });
  });

  it('rejects an empty Bearer value without querying the database', async () => {
    const headers = new Headers({ Authorization: 'Bearer ' });
    const sql = vi.fn();
    const result = await authenticate(headers, new Uint8Array(), {
      sql: sql as unknown as Db,
      webhookSecret: WEBHOOK_SECRET,
    });
    expect(result).toEqual({ authenticated: false });
    expect(sql).not.toHaveBeenCalled();
  });

  it('rejects when the database is not configured', async () => {
    const headers = new Headers({ Authorization: `Bearer ${PRESENTED_KEY}` });
    const result = await authenticate(headers, new Uint8Array(), { webhookSecret: WEBHOOK_SECRET });
    expect(result).toEqual({ authenticated: false });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('DATABASE_URL'));
  });

  it('propagates a database failure instead of reporting a bad credential', async () => {
    const headers = new Headers({ Authorization: `Bearer ${PRESENTED_KEY}` });
    await expect(
      authenticate(headers, new Uint8Array(), { sql: failingDb(), webhookSecret: WEBHOOK_SECRET }),
    ).rejects.toThrow();
  });

  it('never places the presented key in a log line', async () => {
    const headers = new Headers({ Authorization: `Bearer ${PRESENTED_KEY}` });
    await authenticate(headers, new Uint8Array(), {
      sql: emptyDb(),
      webhookSecret: WEBHOOK_SECRET,
    });
    const logged = [
      ...vi.mocked(console.error).mock.calls,
      ...vi.mocked(console.warn).mock.calls,
    ]
      .flat()
      .join(' ');
    expect(logged).not.toContain(PRESENTED_KEY);
  });

  it('authenticates a valid HMAC signature', async () => {
    const bodyStr = '{"text":"hi"}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = await signHmacBody(bodyStr, WEBHOOK_SECRET, timestamp);
    const headers = new Headers({
      'X-OpenBrain-Signature': sig,
      'X-OpenBrain-Timestamp': timestamp,
    });
    const result = await authenticate(headers, new TextEncoder().encode(bodyStr), {
      sql: stubDb(),
      webhookSecret: WEBHOOK_SECRET,
    });
    expect(result).toEqual({ authenticated: true, identifier: 'webhook:hmac', apiKeyId: null });
  });

  it('prefers the API key when both Authorization and signature headers are present', async () => {
    const headers = new Headers({
      Authorization: `Bearer ${PRESENTED_KEY}`,
      'X-OpenBrain-Signature': 'sha256=irrelevant',
    });
    const result = await authenticate(headers, new Uint8Array(), {
      sql: stubDb(),
      webhookSecret: WEBHOOK_SECRET,
    });
    expect(result).toEqual({ authenticated: true, identifier: 'key:laptop', apiKeyId: 'key-1' });
  });

  it('rejects when no auth header is present', async () => {
    const result = await authenticate(new Headers(), new Uint8Array(), {
      sql: stubDb(),
      webhookSecret: WEBHOOK_SECRET,
    });
    expect(result).toEqual({ authenticated: false });
  });

  it('rejects when CAPTURE_WEBHOOK_SECRET is not configured', async () => {
    const headers = new Headers({ 'X-OpenBrain-Signature': 'sha256=abc' });
    const result = await authenticate(headers, new Uint8Array(), { sql: stubDb() });
    expect(result).toEqual({ authenticated: false });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('CAPTURE_WEBHOOK_SECRET'));
  });

  it('rejects an invalid HMAC signature', async () => {
    const headers = new Headers({
      'X-OpenBrain-Signature': 'sha256=deadbeef',
      'X-OpenBrain-Timestamp': String(Math.floor(Date.now() / 1000)),
    });
    const result = await authenticate(headers, new Uint8Array(), {
      sql: stubDb(),
      webhookSecret: WEBHOOK_SECRET,
    });
    expect(result).toEqual({ authenticated: false });
  });
});
