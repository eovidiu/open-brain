// HS256 JWT sign/verify via the Web Crypto API — Cloudflare Workers support
// this natively, no nodejs_compat compatibility flag required. Same wire
// format (base64url header.payload.signature) as the RFC 7519 standard, so
// tokens interoperate with any HS256 verifier (pinned by jwt.test.ts's
// cross-implementation test against the jsonwebtoken package).
import type { TokenResponse } from '../types.js';

const TOKEN_EXPIRY_SECONDS = 3600;
const SUBJECT = 'open-brain-owner';
const HEADER = { alg: 'HS256', typ: 'JWT' };

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
}

export async function signToken(secret: string): Promise<TokenResponse> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = { sub: SUBJECT, iat: now, exp: now + TOKEN_EXPIRY_SECONDS };

  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(HEADER)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  const key = await importHmacKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, signingInput));
  const signatureB64 = base64UrlEncode(signature);

  return {
    token: `${headerB64}.${payloadB64}.${signatureB64}`,
    expires_in: TOKEN_EXPIRY_SECONDS,
    token_type: 'Bearer',
  };
}

export async function verifyToken(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  try {
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64)));
    if (header.alg !== 'HS256') return null;
  } catch {
    return null;
  }

  const key = await importHmacKey(secret);
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  let signature: Uint8Array;
  try {
    signature = base64UrlDecode(signatureB64);
  } catch {
    return null;
  }

  const valid = await crypto.subtle.verify('HMAC', key, signature, signingInput);
  if (!valid) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64))) as JwtPayload;
    if (payload.sub !== SUBJECT) return null;
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
