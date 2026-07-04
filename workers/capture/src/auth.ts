// JWT (HS256) and HMAC signature verification, ported from
// supabase/functions/capture/index.ts. Both use the Web Crypto API, which
// Cloudflare Workers support natively (no nodejs_compat flag required).

const HMAC_SIGNATURE_PREFIX = 'sha256=';
const HMAC_MAX_TIMESTAMP_AGE_SECONDS = 300; // 5 minutes, replay protection
const JWT_SUBJECT = 'open-brain-owner';

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export type JwtVerification =
  | { valid: true; payload: Record<string, unknown> }
  | { valid: false };

export async function verifyJwt(token: string, secret: string): Promise<JwtVerification> {
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false };

  const [headerB64, payloadB64, signatureB64] = parts;

  try {
    const headerJson = new TextDecoder().decode(base64UrlDecode(headerB64));
    const header = JSON.parse(headerJson);
    if (header.alg !== 'HS256') return { valid: false };
  } catch {
    return { valid: false };
  }

  const key = await importHmacKey(secret);
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const expectedSig = base64UrlDecode(signatureB64);

  const valid = await crypto.subtle.verify('HMAC', key, expectedSig, signingInput);
  if (!valid) return { valid: false };

  try {
    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(payloadJson);

    if (payload.sub !== JWT_SUBJECT) return { valid: false };
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false };
  }
}

// Constant-time hex comparison via a second HMAC pass: crypto.subtle has no
// direct timing-safe-equal, so HMAC(key, a) === HMAC(key, b) iff a === b,
// compared here with a branchless XOR accumulator.
async function timingSafeHexEqual(a: string, b: string): Promise<boolean> {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const compareKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(a),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', compareKey, encoder.encode(b)));
  const check = new Uint8Array(await crypto.subtle.sign('HMAC', compareKey, encoder.encode(a)));
  let diff = 0;
  for (let i = 0; i < sig.length; i++) {
    diff |= sig[i] ^ check[i];
  }
  return diff === 0;
}

export async function verifyHmacSignature(
  rawBody: Uint8Array,
  signatureHeader: string,
  secret: string,
  timestamp?: string | null,
): Promise<boolean> {
  if (!signatureHeader.startsWith(HMAC_SIGNATURE_PREFIX)) return false;

  // Timestamp required for replay protection
  if (!timestamp) return false;
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > HMAC_MAX_TIMESTAMP_AGE_SECONDS) return false;

  const providedHex = signatureHeader.slice(HMAC_SIGNATURE_PREFIX.length);

  // Sign timestamp.body to prevent replay
  const payload = new TextEncoder().encode(`${timestamp}.${new TextDecoder().decode(rawBody)}`);
  const key = await importHmacKey(secret);
  const computed = new Uint8Array(await crypto.subtle.sign('HMAC', key, payload));
  const computedHex = bytesToHex(computed);

  return timingSafeHexEqual(computedHex, providedHex);
}

export type AuthResult =
  | { authenticated: true; identifier: string }
  | { authenticated: false };

export async function authenticate(
  headers: Headers,
  rawBody: Uint8Array,
  secrets: { jwtSecret?: string; webhookSecret?: string },
): Promise<AuthResult> {
  const authHeader = headers.get('Authorization');
  const sigHeader = headers.get('X-OpenBrain-Signature');

  // Priority 1: JWT (takes precedence when both present)
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (!secrets.jwtSecret) {
      console.error('[capture] CAPTURE_JWT_SECRET not configured');
      return { authenticated: false };
    }
    const result = await verifyJwt(token, secrets.jwtSecret);
    if (result.valid) {
      return { authenticated: true, identifier: `jwt:${(result.payload.sub as string) || 'unknown'}` };
    }
    return { authenticated: false };
  }

  // Priority 2: HMAC webhook signature
  if (sigHeader) {
    if (!secrets.webhookSecret) {
      console.error('[capture] CAPTURE_WEBHOOK_SECRET not configured');
      return { authenticated: false };
    }
    const timestampHeader = headers.get('X-OpenBrain-Timestamp');
    const valid = await verifyHmacSignature(rawBody, sigHeader, secrets.webhookSecret, timestampHeader);
    if (valid) {
      return { authenticated: true, identifier: 'webhook:hmac' };
    }
    return { authenticated: false };
  }

  return { authenticated: false };
}
