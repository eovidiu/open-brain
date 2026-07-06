// Stateless Streamable HTTP MCP host (AD-4), replacing the Express SSE host
// removed from mcp-server/src/transport/. Routes:
//   POST /auth/token  issues a Bearer JWT after a timing-safe client_secret check
//   GET  /health      DB connectivity + embedding_model, same shape as sse.ts's
//   *    (else)       requires a valid Bearer JWT, then delegates to the MCP
//                      protocol handler (createMcpHandler)
import { createMcpHandler } from 'agents/mcp';
import { createDb, getSystemConfig } from 'open-brain-workers-shared';
import type { Env } from './env.js';
import { createServer } from './server.js';
import { createAuthRateLimiter, createCaptureRateLimiter } from './auth/rate-limiter.js';
import { signToken, verifyToken } from './auth/jwt.js';


const authRateLimiter = createAuthRateLimiter();
const captureRateLimiter = createCaptureRateLimiter();

function jsonResponse(status: number, body: unknown, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

// Web Crypto has no direct timing-safe-equal; compare byte-by-byte with a
// branchless XOR accumulator (same technique as the historical
// supabase/functions/open-brain-mcp/index.ts authenticate()).
function timingSafeStringEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

async function handleAuthToken(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  let body: { client_secret?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'MISSING_SECRET' });
  }

  const clientSecret = body.client_secret;
  if (!clientSecret) {
    return jsonResponse(400, { error: 'MISSING_SECRET' });
  }

  if (!env.MCP_CLIENT_SECRET) {
    return jsonResponse(500, { error: 'Server misconfigured' });
  }

  // Rate limit check BEFORE secret validation (brute force defense).
  const rateCheck = authRateLimiter.check(ip);
  if (!rateCheck.allowed) {
    return jsonResponse(
      429,
      { error: 'RATE_LIMITED' },
      rateCheck.retryAfter ? { 'Retry-After': String(rateCheck.retryAfter) } : undefined,
    );
  }

  if (!timingSafeStringEqual(clientSecret, env.MCP_CLIENT_SECRET)) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  if (!env.CAPTURE_JWT_SECRET) {
    return jsonResponse(500, { error: 'Server misconfigured' });
  }

  const tokenResponse = await signToken(env.CAPTURE_JWT_SECRET);
  return jsonResponse(200, tokenResponse);
}

async function handleHealth(env: Env): Promise<Response> {
  try {
    const sql = createDb(env.DATABASE_URL);
    const config = await getSystemConfig(sql);
    const rows = await sql`SELECT count(*)::int AS count FROM memories`;

    return jsonResponse(200, {
      status: 'ok',
      db_connected: true,
      total_memories: (rows[0]?.count as number) ?? 0,
      embedding_model: config.embedding_model,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[health] DB health check failed: ${message}`);
    return jsonResponse(503, { status: 'degraded', db_connected: false });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/auth/token' && request.method === 'POST') {
      return handleAuthToken(request, env);
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      return handleHealth(env);
    }

    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse(401, { error: 'UNAUTHORIZED' });
    }

    if (!env.CAPTURE_JWT_SECRET) {
      return jsonResponse(500, { error: 'Server misconfigured' });
    }

    const decoded = await verifyToken(authHeader.slice(7), env.CAPTURE_JWT_SECRET);
    if (!decoded) {
      return jsonResponse(401, { error: 'UNAUTHORIZED' });
    }

    const sql = createDb(env.DATABASE_URL);
    const server = createServer({ sql, env, captureLimiter: captureRateLimiter });
    return createMcpHandler(server)(request, env, ctx);
  },
};
