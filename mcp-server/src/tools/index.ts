export const TOOL_DEFINITIONS = [
  {
    name: 'search_brain',
    description:
      'Search your personal knowledge base by semantic meaning. Returns memories ranked by relevance. Only returns records with ready embeddings.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const },
        n: { type: 'integer' as const, default: 10, maximum: 50 },
        filter_type: {
          type: 'string' as const,
          enum: ['decision', 'insight', 'person_note', 'meeting_debrief', 'task', 'reference'],
        },
        since: { type: 'string' as const, format: 'date' },
        wrap_output: { type: 'boolean' as const, default: false },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_recent',
    description:
      'List your most recently captured memories in reverse chronological order. Includes all records regardless of embedding status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        n: { type: 'integer' as const, default: 20, maximum: 100 },
        filter_type: {
          type: 'string' as const,
          enum: ['decision', 'insight', 'person_note', 'meeting_debrief', 'task', 'reference'],
        },
      },
      required: [] as string[],
    },
  },
  {
    name: 'get_stats',
    description: 'Get aggregate statistics about your personal knowledge base.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: 'capture_memory',
    description: 'Capture a new thought, note, or insight into your personal knowledge base.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string' as const, maxLength: 10000 },
        source: {
          type: 'string' as const,
          enum: ['slack', 'claude', 'chatgpt', 'mcp_direct', 'api'],
          default: 'mcp_direct',
        },
      },
      required: ['text'],
    },
  },
] as const;

export { handleSearchBrain } from './search-brain.js';
export { handleListRecent } from './list-recent.js';
export { handleGetStats } from './get-stats.js';
export { handleCaptureMemory } from './capture-memory.js';
