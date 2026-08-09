// Credential verification for the capture endpoint: API keys for owner-driven
// callers, HMAC signatures for webhook platforms that can only hold a static
// shared secret. Both use the Web Crypto API, which Cloudflare Workers support
// natively (no nodejs_compat flag required).
import { authenticateApiKey, type Db } from 'open-brain-workers-shared';

const HMAC_SIGNATURE_PREFIX = 'sha256=';
const HMAC_MAX_TIMESTAMP_AGE_SECONDS = 300; // 5 minutes, replay protection
const BEARER_PREFIX = 'Bearer ';

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
  | { authenticated: true; identifier: string; apiKeyId: string | null }
  | { authenticated: false };

// `sql` is absent only when DATABASE_URL is unset, which disables the API-key
// path without affecting HMAC callers.
export interface AuthDeps {
  sql?: Db;
  webhookSecret?: string;
}

// Throws only when the key lookup itself fails (database unreachable). The
// caller must not report that as a bad credential — a rejected key and an
// unavailable database are different answers.
export async function authenticate(
  headers: Headers,
  rawBody: Uint8Array,
  deps: AuthDeps,
): Promise<AuthResult> {
  const authHeader = headers.get('Authorization');
  const sigHeader = headers.get('X-OpenBrain-Signature');

  // Priority 1: API key (takes precedence when both present)
  if (authHeader?.startsWith(BEARER_PREFIX)) {
    const presented = authHeader.slice(BEARER_PREFIX.length).trim();
    if (!presented) return { authenticated: false };
    if (!deps.sql) {
      console.error('[capture] DATABASE_URL not configured; API-key auth unavailable');
      return { authenticated: false };
    }
    const record = await authenticateApiKey(deps.sql, presented);
    if (!record) return { authenticated: false };
    // The label is unique and non-secret, so it is safe to log and gives the
    // rate limiter a stable per-client bucket.
    return { authenticated: true, identifier: `key:${record.label}`, apiKeyId: record.id };
  }

  // Priority 2: HMAC webhook signature
  if (sigHeader) {
    if (!deps.webhookSecret) {
      console.error('[capture] CAPTURE_WEBHOOK_SECRET not configured');
      return { authenticated: false };
    }
    const timestampHeader = headers.get('X-OpenBrain-Timestamp');
    const valid = await verifyHmacSignature(rawBody, sigHeader, deps.webhookSecret, timestampHeader);
    if (valid) {
      return { authenticated: true, identifier: 'webhook:hmac', apiKeyId: null };
    }
    return { authenticated: false };
  }

  return { authenticated: false };
}
