// Long-lived per-client API keys, presented to the MCP Worker on every request
// and to the capture endpoint by owner-driven callers.
//
// The raw key is high-entropy (32 CSPRNG bytes), so a plain SHA-256 is the
// right digest: a slow KDF defends against low-entropy secrets being brute
// forced, which cannot happen here, and it would run on every MCP request.
// Only the hash is stored; the raw key exists once, at creation.
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { run, toIso } from './db-util.js';

type Db = NeonQueryFunction<false, false>;

export const API_KEY_PREFIX = 'obk_';

const KEY_BYTES = 32;

export interface ApiKeyRecord {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateApiKey(): string {
  const bytes = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(bytes);
  return `${API_KEY_PREFIX}${base64UrlEncode(bytes)}`;
}

export async function hashApiKey(rawKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Web Crypto has no timing-safe compare; accumulate differences with a
// branchless XOR so the loop runs the same way for every input.
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

function toRecord(row: Record<string, unknown>): ApiKeyRecord {
  return {
    id: row.id as string,
    label: row.label as string,
    created_at: toIso(row.created_at),
    last_used_at: row.last_used_at ? toIso(row.last_used_at) : null,
    revoked_at: row.revoked_at ? toIso(row.revoked_at) : null,
  };
}

// The returned key is the only time the raw value exists outside the client.
export async function createApiKey(
  sql: Db,
  label: string,
): Promise<{ record: ApiKeyRecord; key: string }> {
  const key = generateApiKey();
  const keyHash = await hashApiKey(key);

  const rows = await run('create api key', () => sql`
    INSERT INTO api_keys (label, key_hash)
    VALUES (${label}, ${keyHash})
    RETURNING id, label, created_at, last_used_at, revoked_at
  `);

  return { record: toRecord(rows[0]), key };
}

export async function listApiKeys(sql: Db): Promise<ApiKeyRecord[]> {
  const rows = await run('list api keys', () => sql`
    SELECT id, label, created_at, last_used_at, revoked_at
    FROM api_keys
    ORDER BY created_at DESC
  `);

  return rows.map(toRecord);
}

export async function revokeApiKey(sql: Db, label: string): Promise<ApiKeyRecord> {
  const rows = await run('revoke api key', () => sql`
    UPDATE api_keys
    SET revoked_at = now()
    WHERE label = ${label} AND revoked_at IS NULL
    RETURNING id, label, created_at, last_used_at, revoked_at
  `);

  if (rows.length === 0) {
    throw new Error(`No active API key with label: ${label}`);
  }
  return toRecord(rows[0]);
}

// Resolves the key's record, or null when the key is unknown or revoked —
// the caller must not distinguish the two cases to a client.
export async function authenticateApiKey(
  sql: Db,
  rawKey: string,
): Promise<ApiKeyRecord | null> {
  if (!rawKey) return null;

  const keyHash = await hashApiKey(rawKey);
  const rows = await run('authenticate api key', () => sql`
    SELECT id, label, key_hash, created_at, last_used_at, revoked_at
    FROM api_keys
    WHERE key_hash = ${keyHash}
  `);

  const row = rows[0];
  if (!row) return null;
  if (row.revoked_at) return null;
  if (!timingSafeEqual(row.key_hash as string, keyHash)) return null;

  return toRecord(row);
}

export async function touchApiKey(sql: Db, id: string): Promise<void> {
  await run('touch api key', () => sql`
    UPDATE api_keys SET last_used_at = now() WHERE id = ${id}
  `);
}
