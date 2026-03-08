import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSystemConfig } from './db/queries.js';
import { handleSearchBrain } from './tools/search-brain.js';
import { handleListRecent } from './tools/list-recent.js';
import { handleGetStats } from './tools/get-stats.js';
import { handleCaptureMemory, CaptureValidationError, DbWriteError } from './tools/capture-memory.js';
import { startStdioTransport } from './transport/stdio.js';
import { startSSETransport } from './transport/sse.js';
import { createCaptureRateLimiter } from './auth/rate-limiter.js';

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const SSE_PORT = parseInt(process.env.MCP_SERVER_PORT || '3001', 10);
const captureRateLimiter = createCaptureRateLimiter();

async function validateSystemConfig(): Promise<void> {
  try {
    const config = await getSystemConfig();
    if (config.embedding_model !== EMBEDDING_MODEL) {
      console.error(
        `[FATAL] Embedding model mismatch: system_config has "${config.embedding_model}" but server configured with "${EMBEDDING_MODEL}". ` +
        `Mixing models is prohibited. Update system_config or EMBEDDING_MODEL env var.`
      );
      process.exit(1);
    }
    console.error(`[startup] system_config validated: model=${config.embedding_model}, dimensions=${config.embedding_dimensions}`);
  } catch (err) {
    console.error(`[FATAL] Cannot read system_config: ${err instanceof Error ? err.message : 'Unknown error'}`);
    process.exit(1);
  }
}

function createServer(): McpServer {
  const server = new McpServer({
    name: 'open-brain',
    version: '1.0.0-mvp',
  });

  // search_brain
  server.tool(
    'search_brain',
    'Search your personal knowledge base by semantic meaning. Returns memories ranked by relevance.',
    {
      query: z.string(),
      n: z.number().int().min(1).max(50).default(10),
      filter_type: z.enum(['decision', 'insight', 'person_note', 'meeting_debrief', 'task', 'reference']).optional(),
      since: z.string().optional(),
      wrap_output: z.boolean().default(false),
    },
    async (params) => {
      try {
        const results = await handleSearchBrain(params);
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal error';
        console.error(`[search_brain] ${message}`);
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'SEARCH_FAILED', message: 'Failed to search memories' }) }], isError: true };
      }
    },
  );

  // list_recent
  server.tool(
    'list_recent',
    'List your most recently captured memories in reverse chronological order.',
    {
      n: z.number().int().min(1).max(100).default(20),
      filter_type: z.enum(['decision', 'insight', 'person_note', 'meeting_debrief', 'task', 'reference']).optional(),
      wrap_output: z.boolean().default(false),
    },
    async (params) => {
      try {
        const results = await handleListRecent(params);
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal error';
        console.error(`[list_recent] ${message}`);
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'LIST_FAILED', message: 'Failed to list memories' }) }], isError: true };
      }
    },
  );

  // get_stats
  server.tool(
    'get_stats',
    'Get aggregate statistics about your personal knowledge base.',
    {},
    async () => {
      try {
        const stats = await handleGetStats();
        return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal error';
        console.error(`[get_stats] ${message}`);
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'STATS_FAILED', message: 'Failed to get stats' }) }], isError: true };
      }
    },
  );

  // capture_memory
  server.tool(
    'capture_memory',
    'Capture a new thought, note, or insight into your personal knowledge base.',
    {
      text: z.string().max(10000),
      source: z.enum(['slack', 'claude', 'chatgpt', 'mcp_direct', 'api']).default('mcp_direct'),
    },
    async (params) => {
      // FR-MCP-02: same rate limits as HTTP capture endpoint
      const rateCheck = captureRateLimiter.check('mcp_capture');
      if (!rateCheck.allowed) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'RATE_LIMITED', retry_after: rateCheck.retryAfter }) }],
          isError: true,
        };
      }

      try {
        const result = await handleCaptureMemory(params);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        if (err instanceof CaptureValidationError) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: err.code, message: err.message }) }], isError: true };
        }
        if (err instanceof DbWriteError) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'DB_WRITE_FAILED', message: 'Failed to persist memory' }) }], isError: true };
        }
        throw err;
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  console.error('[startup] Open Brain MCP Server v1.0.0-mvp');

  await validateSystemConfig();

  const mcpServer = createServer();

  // Determine transport mode
  const isStdio = process.argv.includes('--stdio');
  const isSSEOnly = process.argv.includes('--sse-only');

  if (isStdio) {
    await startStdioTransport(mcpServer.server);
  } else if (isSSEOnly) {
    await startSSETransport(mcpServer.server, SSE_PORT);
  } else {
    // Default: SSE transport (stdio requires exclusive access to stdin/stdout)
    await startSSETransport(mcpServer.server, SSE_PORT);
    console.error('[startup] Use --stdio flag for stdio transport mode');
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
