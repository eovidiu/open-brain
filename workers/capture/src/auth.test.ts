import { authenticate, verifyHmacSignature, verifyJwt } from './auth.js';

const JWT_SECRET = 'jwt-secret-value';
const WEBHOOK_SECRET = 'webhook-secret-value';

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeJson(obj: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  alg = 'HS256',
): Promise<string> {
  const header = { alg, typ: 'JWT' };
  const headerB64 = base64UrlEncodeJson(header);
  const payloadB64 = base64UrlEncodeJson(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

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

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return { sub: 'open-brain-owner', iat: now, exp: now + 3600, ...overrides };
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

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('verifyJwt', () => {
  it('accepts a validly signed HS256 token', async () => {
    const token = await signJwt(validPayload(), JWT_SECRET);
    const result = await verifyJwt(token, JWT_SECRET);
    expect(result.valid).toBe(true);
  });

  it('rejects a token with the wrong signature', async () => {
    const token = await signJwt(validPayload(), 'wrong-secret');
    const result = await verifyJwt(token, JWT_SECRET);
    expect(result.valid).toBe(false);
  });

  it('rejects a non-HS256 header', async () => {
    const token = await signJwt(validPayload(), JWT_SECRET, 'none');
    const result = await verifyJwt(token, JWT_SECRET);
    expect(result.valid).toBe(false);
  });

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(validPayload({ exp: now - 10 }), JWT_SECRET);
    const result = await verifyJwt(token, JWT_SECRET);
    expect(result.valid).toBe(false);
  });

  it('rejects the wrong subject', async () => {
    const token = await signJwt(validPayload({ sub: 'someone-else' }), JWT_SECRET);
    const result = await verifyJwt(token, JWT_SECRET);
    expect(result.valid).toBe(false);
  });

  it('rejects a malformed token', async () => {
    const result = await verifyJwt('not.a.valid.jwt', JWT_SECRET);
    expect(result.valid).toBe(false);
  });

  it('rejects unparseable header/payload', async () => {
    const result = await verifyJwt('not-base64.also-not.sig', JWT_SECRET);
    expect(result.valid).toBe(false);
  });

  it('rejects a validly signed token whose payload is not JSON', async () => {
    const header = base64UrlEncodeJson({ alg: 'HS256', typ: 'JWT' });
    const payload = base64UrlEncode(new TextEncoder().encode('not-json-payload'));
    const signingInput = `${header}.${payload}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput)));
    const token = `${signingInput}.${base64UrlEncode(sig)}`;

    const result = await verifyJwt(token, JWT_SECRET);
    expect(result.valid).toBe(false);
  });
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
  it('authenticates a valid JWT Bearer token', async () => {
    const token = await signJwt(validPayload(), JWT_SECRET);
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    const result = await authenticate(headers, new Uint8Array(), {
      jwtSecret: JWT_SECRET,
      webhookSecret: WEBHOOK_SECRET,
    });
    expect(result).toEqual({ authenticated: true, identifier: 'jwt:open-brain-owner' });
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
      jwtSecret: JWT_SECRET,
      webhookSecret: WEBHOOK_SECRET,
    });
    expect(result).toEqual({ authenticated: true, identifier: 'webhook:hmac' });
  });

  it('prefers JWT when both Authorization and signature headers are present', async () => {
    const token = await signJwt(validPayload(), JWT_SECRET);
    const headers = new Headers({
      Authorization: `Bearer ${token}`,
      'X-OpenBrain-Signature': 'sha256=irrelevant',
    });
    const result = await authenticate(headers, new Uint8Array(), {
      jwtSecret: JWT_SECRET,
      webhookSecret: WEBHOOK_SECRET,
    });
    expect(result).toEqual({ authenticated: true, identifier: 'jwt:open-brain-owner' });
  });

  it('rejects when no auth header is present', async () => {
    const result = await authenticate(new Headers(), new Uint8Array(), {
      jwtSecret: JWT_SECRET,
      webhookSecret: WEBHOOK_SECRET,
    });
    expect(result).toEqual({ authenticated: false });
  });

  it('rejects an invalid JWT', async () => {
    const headers = new Headers({ Authorization: 'Bearer not-a-real-token' });
    const result = await authenticate(headers, new Uint8Array(), {
      jwtSecret: JWT_SECRET,
      webhookSecret: WEBHOOK_SECRET,
    });
    expect(result).toEqual({ authenticated: false });
  });

  it('rejects when CAPTURE_JWT_SECRET is not configured', async () => {
    const token = await signJwt(validPayload(), JWT_SECRET);
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    const result = await authenticate(headers, new Uint8Array(), { webhookSecret: WEBHOOK_SECRET });
    expect(result).toEqual({ authenticated: false });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('CAPTURE_JWT_SECRET'));
  });

  it('rejects when CAPTURE_WEBHOOK_SECRET is not configured', async () => {
    const headers = new Headers({ 'X-OpenBrain-Signature': 'sha256=abc' });
    const result = await authenticate(headers, new Uint8Array(), { jwtSecret: JWT_SECRET });
    expect(result).toEqual({ authenticated: false });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('CAPTURE_WEBHOOK_SECRET'));
  });

  it('rejects an invalid HMAC signature', async () => {
    const headers = new Headers({
      'X-OpenBrain-Signature': 'sha256=deadbeef',
      'X-OpenBrain-Timestamp': String(Math.floor(Date.now() / 1000)),
    });
    const result = await authenticate(headers, new Uint8Array(), {
      jwtSecret: JWT_SECRET,
      webhookSecret: WEBHOOK_SECRET,
    });
    expect(result).toEqual({ authenticated: false });
  });
});
