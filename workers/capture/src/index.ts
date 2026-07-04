// Cloudflare Worker capture endpoint, ported from
// supabase/functions/capture/index.ts. Preserves auth (JWT HS256 + HMAC
// replay-protected signature), AD-6 embedding/metadata degradation, and
// metadata output validation verbatim; adapts Deno.serve/Deno.env to the
// Workers fetch handler and env bindings.
import { createDb, insertMemory, type InsertMemoryRecord, type MemorySource } from 'open-brain-workers-shared';
import { authenticate } from './auth.js';
import { checkRateLimit } from './rate-limit.js';
import { fetchEmbedding } from './embedding.js';
import { extractMetadata, DEGRADED_METADATA } from './metadata.js';
import type { Env } from './env.js';

const VALID_SOURCES = new Set(['slack', 'claude', 'chatgpt', 'mcp_direct', 'api']);
const TEXT_MAX_LENGTH = 10_000;

// No wildcard origin: this endpoint is server-to-server only (security
// carry-forward — the wildcard was removed upstream in 6b72bf6 and must not
// be reintroduced). If browser-based capture is needed later, make the
// origin configurable via env var instead of widening this.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-OpenBrain-Signature, X-OpenBrain-Timestamp',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(status: number, body: Record<string, unknown>, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extra },
  });
}

function errorResponse(status: number, code: string, extra?: Record<string, string>): Response {
  return jsonResponse(status, { error: code }, extra);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (req.method !== 'POST') {
      return errorResponse(405, 'METHOD_NOT_ALLOWED');
    }

    const startTime = Date.now();
    const rawBody = new Uint8Array(await req.arrayBuffer());

    const authResult = await authenticate(req.headers, rawBody, {
      jwtSecret: env.CAPTURE_JWT_SECRET,
      webhookSecret: env.CAPTURE_WEBHOOK_SECRET,
    });
    if (!authResult.authenticated) {
      return errorResponse(401, 'UNAUTHORIZED');
    }
    const credentialId = authResult.identifier;

    const rateCheck = checkRateLimit(credentialId);
    if (!rateCheck.allowed) {
      console.warn(`[capture] Rate limited: credential=${credentialId}`);
      return errorResponse(429, 'RATE_LIMITED', { 'Retry-After': String(rateCheck.retryAfter) });
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      return errorResponse(400, 'INVALID_TEXT');
    }

    const rawText = body.text;
    if (typeof rawText !== 'string' || rawText.trim().length === 0 || rawText.length > TEXT_MAX_LENGTH) {
      return errorResponse(400, 'INVALID_TEXT');
    }

    const source = body.source ?? 'api';
    if (typeof source !== 'string' || !VALID_SOURCES.has(source)) {
      return errorResponse(400, 'INVALID_SOURCE');
    }

    const [embeddingResult, metadataResult] = await Promise.allSettled([
      fetchEmbedding(rawText, env.OPENAI_API_KEY),
      extractMetadata(rawText, {
        provider: env.METADATA_LLM_PROVIDER,
        openaiApiKey: env.OPENAI_API_KEY,
        openaiMetadataApiKey: env.OPENAI_METADATA_API_KEY,
        anthropicApiKey: env.ANTHROPIC_API_KEY,
      }),
    ]);

    const embedding = embeddingResult.status === 'fulfilled' ? embeddingResult.value : null;
    const embeddingStatus = embedding ? 'ready' : 'pending';

    const metadataRaw = metadataResult.status === 'fulfilled' ? metadataResult.value : null;
    const metadata = metadataRaw ?? DEGRADED_METADATA;
    const metadataStatus = metadataRaw ? 'ready' : 'degraded';

    const capturedAt = new Date().toISOString();

    console.log(
      `[capture] source=${source} embedding_status=${embeddingStatus} metadata_status=${metadataStatus} ` +
        `elapsed=${Date.now() - startTime}ms`,
    );

    if (!env.DATABASE_URL) {
      console.error('[capture] DATABASE_URL not configured');
      return errorResponse(500, 'DB_WRITE_FAILED');
    }

    const record: InsertMemoryRecord = {
      id: crypto.randomUUID(),
      raw_text: rawText,
      embedding,
      embedding_status: embeddingStatus,
      metadata,
      metadata_status: metadataStatus,
      captured_at: capturedAt,
      source: source as MemorySource,
    };

    try {
      const sql = createDb(env.DATABASE_URL);
      const result = await insertMemory(sql, record);
      return jsonResponse(201, { ...result });
    } catch (err) {
      console.error(`[capture] DB write failed: ${(err as Error).message}`);
      return errorResponse(500, 'DB_WRITE_FAILED');
    }
  },
};
