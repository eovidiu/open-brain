import express from 'express';
import type { Request, Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { signToken, verifyToken } from '../auth/jwt.js';
import { createAuthRateLimiter } from '../auth/rate-limiter.js';
import { authenticateSSE } from '../auth/middleware.js';
import { getSystemConfig } from '../db/queries.js';

export async function startSSETransport(server: Server, port: number): Promise<void> {
  const app = express();
  const authLimiter = createAuthRateLimiter();
  const transports = new Map<string, SSEServerTransport>();

  // Raw body for HMAC verification
  app.use(express.json({
    verify: (req: Request, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }));

  // POST /auth/token
  app.post('/auth/token', (req: Request, res: Response) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const { client_secret } = req.body as { client_secret?: string };

    if (!client_secret) {
      res.status(400).json({ error: 'MISSING_SECRET' });
      return;
    }

    const expectedSecret = process.env.MCP_CLIENT_SECRET;
    if (!expectedSecret) {
      res.status(500).json({ error: 'Server misconfigured' });
      return;
    }

    // Rate limit check BEFORE secret validation (brute force defense)
    const rateCheck = authLimiter.check(ip);
    if (!rateCheck.allowed) {
      if (rateCheck.retryAfter) {
        res.setHeader('Retry-After', rateCheck.retryAfter.toString());
      }
      res.status(429).json({ error: 'RATE_LIMITED' });
      return;
    }

    if (client_secret !== expectedSecret) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const jwtSecret = process.env.CAPTURE_JWT_SECRET;
    if (!jwtSecret) {
      res.status(500).json({ error: 'Server misconfigured' });
      return;
    }

    const tokenResponse = signToken(jwtSecret);
    res.json(tokenResponse);
  });

  // GET /health
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      const config = await getSystemConfig();
      const { getSupabaseClient } = await import('../db/client.js');
      const supabase = getSupabaseClient();
      const { count } = await supabase.from('memories').select('*', { count: 'exact', head: true });

      res.json({
        status: 'ok',
        db_connected: true,
        total_memories: count ?? 0,
        embedding_model: config.embedding_model,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[health] DB health check failed: ${message}`);
      res.status(503).json({
        status: 'degraded',
        db_connected: false,
      });
    }
  });

  // GET /sse — SSE connection endpoint
  app.get('/sse', authenticateSSE, async (req: Request, res: Response) => {
    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;
    transports.set(sessionId, transport);

    // Check JWT expiry and send auth_expired event
    const token = req.headers.authorization!.slice(7);
    const jwtSecret = process.env.CAPTURE_JWT_SECRET!;
    const decoded = verifyToken(token, jwtSecret);
    if (decoded) {
      const expiresIn = decoded.exp * 1000 - Date.now();
      if (expiresIn > 0) {
        setTimeout(() => {
          res.write(`event: auth_expired\ndata: {}\n\n`);
          transport.close();
          transports.delete(sessionId);
        }, expiresIn);
      }
    }

    res.on('close', () => {
      transports.delete(sessionId);
    });

    await server.connect(transport);
  });

  // POST /messages — SSE message handling
  app.post('/messages', authenticateSSE, async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(400).json({ error: 'Invalid session' });
      return;
    }
    await transport.handlePostMessage(req, res);
  });

  app.listen(port, () => {
    console.error(`[sse] MCP server listening on port ${port}`);
  });
}
