// MCP read queries (search/list/stats/config). Consolidated from
// workers/mcp/src/db.ts (F010); originally ported from
// mcp-server/src/db/queries.ts. The `sql: Db` handle is an explicit
// parameter — Workers get config per request from env bindings.
import type { NeonQueryFunction } from '@neondatabase/serverless';
import type {
  EmbeddingStatus,
  MemoryMetadata,
  MemorySource,
  MetadataStatus,
  RecentMemory,
  SearchResult,
  StatsResponse,
  SystemConfig,
} from './types.js';
import { run, toIso } from './db-util.js';

type Db = NeonQueryFunction<false, false>;

export async function searchMemories(
  sql: Db,
  queryVector: number[],
  n: number,
  filterType?: string,
  since?: string,
): Promise<SearchResult[]> {
  const rows = await run('search memories', () => sql`
    SELECT * FROM search_memories(
      ${JSON.stringify(queryVector)}::vector,
      ${n},
      ${filterType ?? null},
      ${since ?? null}
    )
  `);

  return rows.map((row) => ({
    id: row.id as string,
    raw_text: row.raw_text as string,
    captured_at: toIso(row.captured_at),
    source: row.source as MemorySource,
    metadata: row.metadata as MemoryMetadata,
    metadata_status: row.metadata_status as MetadataStatus,
    embedding_status: row.embedding_status as EmbeddingStatus,
    similarity_score: row.similarity_score as number,
  }));
}

export async function listRecentMemories(
  sql: Db,
  n: number,
  filterType?: string,
): Promise<RecentMemory[]> {
  const rows = await run('list memories', () =>
    filterType
      ? sql`
          SELECT id, raw_text, metadata, metadata_status, captured_at, source
          FROM memories
          WHERE metadata->>'type' = ${filterType}
          ORDER BY captured_at DESC
          LIMIT ${n}
        `
      : sql`
          SELECT id, raw_text, metadata, metadata_status, captured_at, source
          FROM memories
          ORDER BY captured_at DESC
          LIMIT ${n}
        `,
  );

  return rows.map((row) => ({
    id: row.id as string,
    raw_text: row.raw_text as string,
    metadata: row.metadata as MemoryMetadata,
    metadata_status: row.metadata_status as MetadataStatus,
    captured_at: toIso(row.captured_at),
    source: row.source as MemorySource,
  }));
}

export async function getStats(sql: Db): Promise<StatsResponse> {
  const rows = await run('get stats', () => sql`SELECT get_memory_stats() AS stats`);
  const raw = rows[0].stats as Record<string, unknown>;

  return {
    total_memories: raw.total_memories as number,
    last_7_days: raw.last_7_days as number,
    last_30_days: raw.last_30_days as number,
    by_type: raw.by_type as Record<string, number>,
    by_embedding_status: raw.by_embedding_status as Record<EmbeddingStatus, number>,
    embedding_model: raw.embedding_model as string,
    top_topics: raw.top_topics as Array<{ topic: string; count: number }>,
  };
}

export async function getSystemConfig(sql: Db): Promise<SystemConfig> {
  const config = await run('read system config', async () => {
    const rows = await sql`SELECT * FROM system_config WHERE id = 1`;
    if (rows.length === 0) {
      throw new Error('system_config row missing');
    }
    return rows[0];
  });

  return {
    id: config.id as number,
    embedding_model: config.embedding_model as string,
    embedding_dimensions: config.embedding_dimensions as number,
    created_at: toIso(config.created_at),
    updated_at: toIso(config.updated_at),
  };
}
