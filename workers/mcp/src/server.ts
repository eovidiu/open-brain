// McpServer factory. Mirrors mcp-server/src/index.ts's createServer(), but a
// fresh instance is built per Worker request (deps close over that request's
// sql connection and env) instead of once at process startup, since the
// Agents SDK forbids reconnecting an already-connected server to a new
// transport.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Db } from 'open-brain-workers-shared';
import type { Env } from './env.js';
import type { RateLimiter } from './auth/rate-limiter.js';
import { handleSearchBrain } from './tools/search-brain.js';
import { handleListRecent } from './tools/list-recent.js';
import { handleGetStats } from './tools/get-stats.js';
import { handleCaptureMemory, CaptureValidationError, DbWriteError } from './tools/capture-memory.js';
import { handleDeleteMemory } from './tools/delete-memory.js';

export const TOOL_NAMES = ['search_brain', 'list_recent', 'get_stats', 'capture_memory', 'delete_memory'] as const;

export interface ServerDeps {
  sql: Db;
  env: Env;
  captureLimiter: RateLimiter;
}

const MEMORY_TYPE_ENUM = ['decision', 'insight', 'person_note', 'meeting_debrief', 'task', 'reference'] as const;
const SOURCE_ENUM = ['slack', 'claude', 'chatgpt', 'mcp_direct', 'api'] as const;

function textResult(payload: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }], isError };
}

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: 'open-brain', version: '1.0.0-mvp' });

  server.registerTool(
    'search_brain',
    {
      description:
        'Search your personal knowledge base by semantic meaning. Returns memories ranked by relevance.',
      inputSchema: {
        query: z.string(),
        n: z.number().int().min(1).max(50).default(10),
        filter_type: z.enum(MEMORY_TYPE_ENUM).optional(),
        since: z.string().optional(),
        wrap_output: z.boolean().default(false),
      },
    },
    async (params) => {
      try {
        const results = await handleSearchBrain(deps.sql, deps.env.OPENAI_API_KEY, params);
        return textResult(results);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal error';
        console.error(`[search_brain] ${message}`);
        return textResult({ error: 'SEARCH_FAILED', message: 'Failed to search memories' }, true);
      }
    },
  );

  server.registerTool(
    'list_recent',
    {
      description: 'List your most recently captured memories in reverse chronological order.',
      inputSchema: {
        n: z.number().int().min(1).max(100).default(20),
        filter_type: z.enum(MEMORY_TYPE_ENUM).optional(),
        wrap_output: z.boolean().default(false),
      },
    },
    async (params) => {
      try {
        const results = await handleListRecent(deps.sql, params);
        return textResult(results);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal error';
        console.error(`[list_recent] ${message}`);
        return textResult({ error: 'LIST_FAILED', message: 'Failed to list memories' }, true);
      }
    },
  );

  server.registerTool(
    'get_stats',
    {
      description: 'Get aggregate statistics about your personal knowledge base.',
      inputSchema: {},
    },
    async () => {
      try {
        const stats = await handleGetStats(deps.sql);
        return textResult(stats);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal error';
        console.error(`[get_stats] ${message}`);
        return textResult({ error: 'STATS_FAILED', message: 'Failed to get stats' }, true);
      }
    },
  );

  server.registerTool(
    'capture_memory',
    {
      description: 'Capture a new thought, note, or insight into your personal knowledge base.',
      inputSchema: {
        text: z.string().max(10000),
        source: z.enum(SOURCE_ENUM).default('mcp_direct'),
      },
    },
    async (params) => {
      // Same limit as the capture HTTP endpoint (FR-MCP-02).
      const rateCheck = deps.captureLimiter.check('mcp_capture');
      if (!rateCheck.allowed) {
        return textResult({ error: 'RATE_LIMITED', retry_after: rateCheck.retryAfter }, true);
      }

      try {
        const result = await handleCaptureMemory(
          deps.sql,
          {
            apiKey: deps.env.OPENAI_API_KEY,
            metadataConfig: {
              provider: deps.env.METADATA_LLM_PROVIDER,
              openaiApiKey: deps.env.OPENAI_API_KEY,
              openaiMetadataApiKey: deps.env.OPENAI_METADATA_API_KEY,
              anthropicApiKey: deps.env.ANTHROPIC_API_KEY,
            },
          },
          params,
        );
        return textResult(result);
      } catch (err) {
        if (err instanceof CaptureValidationError) {
          return textResult({ error: err.code, message: err.message }, true);
        }
        if (err instanceof DbWriteError) {
          return textResult({ error: 'DB_WRITE_FAILED', message: 'Failed to persist memory' }, true);
        }
        throw err;
      }
    },
  );

  server.registerTool(
    'delete_memory',
    {
      description:
        'Permanently delete one memory by its exact id. The id must come from a prior search_brain or list_recent result.',
      inputSchema: {
        id: z.string().uuid(),
      },
    },
    async (params) => {
      try {
        const result = await handleDeleteMemory(deps.sql, params);
        return textResult(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal error';
        console.error(`[delete_memory] ${message}`);
        const notFound = message.startsWith('Memory not found');
        return textResult(
          {
            error: notFound ? 'NOT_FOUND' : 'DELETE_FAILED',
            message: notFound ? message : 'Failed to delete memory',
          },
          true,
        );
      }
    },
  );

  return server;
}
