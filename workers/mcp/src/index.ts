// Stateless Streamable HTTP MCP host (AD-4). Routes:
//   GET  /health      DB connectivity + embedding_model
//   *    (else)       requires a live API key in Authorization: Bearer, then
//                      delegates to the MCP protocol handler (createMcpHandler)
//
// Clients hold a long-lived key issued by `openbrain keys create`, so a static
// config file keeps working indefinitely. Failed authentications are charged
// against a per-IP budget; successful ones cost nothing.
import { createMcpHandler } from 'agents/mcp';
import {
  authenticateApiKey,
  createDb,
  getSystemConfig,
  touchApiKey,
} from 'open-brain-workers-shared';
import type { Env } from './env.js';
import { createServer } from './server.js';
import { createAuthRateLimiter, createCaptureRateLimiter } from './auth/rate-limiter.js';

const authRateLimiter = createAuthRateLimiter();
const captureRateLimiter = createCaptureRateLimiter();

const BEARER_PREFIX = 'Bearer ';

function jsonResponse(status: number, body: unknown, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

function presentedKey(request: Request): string {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith(BEARER_PREFIX)) return '';
  return header.slice(BEARER_PREFIX.length).trim();
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

    if (url.pathname === '/health' && request.method === 'GET') {
      return handleHealth(env);
    }

    // Removed in F013 along with the JWT it issued; clients use API keys.
    if (url.pathname === '/auth/token') {
      return jsonResponse(404, { error: 'NOT_FOUND' });
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    // Checked before the key lookup so a flood never reaches the database.
    const rateCheck = authRateLimiter.blocked(ip);
    if (!rateCheck.allowed) {
      return jsonResponse(429, { error: 'RATE_LIMITED' }, {
        'Retry-After': String(rateCheck.retryAfter),
      });
    }

    const key = presentedKey(request);
    if (!key) {
      authRateLimiter.record(ip);
      return jsonResponse(401, { error: 'UNAUTHORIZED' });
    }

    const sql = createDb(env.DATABASE_URL);

    let apiKey;
    try {
      apiKey = await authenticateApiKey(sql, key);
    } catch {
      // authenticateApiKey already logged a sanitized message; the raw key is
      // never part of it.
      return jsonResponse(503, { error: 'SERVICE_UNAVAILABLE' });
    }

    // Unknown and revoked keys are indistinguishable to the client.
    if (!apiKey) {
      authRateLimiter.record(ip);
      return jsonResponse(401, { error: 'UNAUTHORIZED' });
    }

    ctx.waitUntil(touchApiKey(sql, apiKey.id));

    const server = createServer({ sql, env, captureLimiter: captureRateLimiter });
    return createMcpHandler(server)(request, env, ctx);
  },
};
