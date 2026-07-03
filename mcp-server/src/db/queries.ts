import { getDb } from './client.js';
import type {
  CaptureResponse,
  EmbeddingStatus,
  Memory,
  MemoryMetadata,
  MemorySource,
  SearchResult,
  StatsResponse,
  SystemConfig,
} from '../types.js';

const MAX_EMBEDDING_RETRIES = 10;
const MAX_METADATA_RETRIES = 10;

function sanitizeDbError(context: string, error: { message: string }): Error {
  console.error(`[db] ${context}: ${error.message}`);
  return new Error(`Database operation failed: ${context}`);
}

async function run<T>(context: string, query: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (error) {
    throw sanitizeDbError(context, error as Error);
  }
}

// timestamptz values arrive as Date (driver-parsed) or string; normalize to ISO
function toIso(value: unknown): string {
  return new Date(value as string | Date).toISOString();
}

// vector columns arrive as their text form, e.g. "[0.1,0.2]"
function parseVector(value: unknown): number[] | null {
  if (value == null) return null;
  return typeof value === 'string' ? (JSON.parse(value) as number[]) : (value as number[]);
}

// Insert a new memory record and return a CaptureResponse
export async function insertMemory(record: {
  id: string;
  raw_text: string;
  embedding: number[] | null;
  embedding_status: EmbeddingStatus;
  metadata: MemoryMetadata;
  metadata_status: 'ready' | 'degraded';
  captured_at: string;
  source: MemorySource;
}): Promise<CaptureResponse> {
  const sql = getDb();
  const embedding = record.embedding ? JSON.stringify(record.embedding) : null;

  const rows = await run('insert memory', () => sql`
    INSERT INTO memories (
      id, raw_text, embedding, embedding_status, metadata, metadata_status,
      captured_at, source, retry_count_embedding, retry_count_metadata,
      last_processing_error
    )
    VALUES (
      ${record.id}, ${record.raw_text}, ${embedding}::vector,
      ${record.embedding_status}, ${JSON.stringify(record.metadata)}::jsonb,
      ${record.metadata_status}, ${record.captured_at}, ${record.source},
      0, 0, NULL
    )
    RETURNING id, captured_at, source, embedding_status, metadata_status, metadata
  `);
  const row = rows[0];

  return {
    id: row.id as string,
    captured_at: toIso(row.captured_at),
    source: row.source as MemorySource,
    embedding_status: row.embedding_status as EmbeddingStatus,
    metadata_status: row.metadata_status as 'ready' | 'degraded',
    metadata: row.metadata as MemoryMetadata,
  };
}

// Vector similarity search using pgvector
export async function searchMemories(
  queryVector: number[],
  n: number,
  filterType?: string,
  since?: string,
): Promise<SearchResult[]> {
  const sql = getDb();

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
    metadata_status: row.metadata_status as 'ready' | 'degraded',
    embedding_status: row.embedding_status as EmbeddingStatus,
    similarity_score: row.similarity_score as number,
  }));
}

// List recent memories ordered by captured_at DESC
export async function listRecentMemories(
  n: number,
  filterType?: string,
): Promise<Memory[]> {
  const sql = getDb();

  const rows = await run('list memories', () =>
    filterType
      ? sql`
          SELECT * FROM memories
          WHERE metadata->>'type' = ${filterType}
          ORDER BY captured_at DESC
          LIMIT ${n}
        `
      : sql`
          SELECT * FROM memories
          ORDER BY captured_at DESC
          LIMIT ${n}
        `,
  );

  return rows.map((row) => ({
    id: row.id as string,
    raw_text: row.raw_text as string,
    embedding: parseVector(row.embedding),
    embedding_status: row.embedding_status as EmbeddingStatus,
    metadata: row.metadata as MemoryMetadata,
    metadata_status: row.metadata_status as 'ready' | 'degraded',
    captured_at: toIso(row.captured_at),
    source: row.source as MemorySource,
    retry_count_embedding: row.retry_count_embedding as number,
    retry_count_metadata: row.retry_count_metadata as number,
    last_processing_error: row.last_processing_error as string | null,
  }));
}

// Aggregate stats query
export async function getStats(): Promise<StatsResponse> {
  const sql = getDb();

  const rows = await run('get stats', () => sql`
    SELECT get_memory_stats() AS stats
  `);
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

// Read system_config singleton
export async function getSystemConfig(): Promise<SystemConfig> {
  const sql = getDb();

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

// Set embedding and mark status as ready
export async function updateMemoryEmbedding(
  id: string,
  embedding: number[],
): Promise<void> {
  const sql = getDb();

  await run('update embedding', () => sql`
    UPDATE memories SET
      embedding = ${JSON.stringify(embedding)}::vector,
      embedding_status = 'ready',
      last_processing_error = NULL
    WHERE id = ${id}
  `);
}

// Set metadata and mark status as ready
export async function updateMemoryMetadata(
  id: string,
  metadata: MemoryMetadata,
): Promise<void> {
  const sql = getDb();

  await run('update metadata', () => sql`
    UPDATE memories SET
      metadata = ${JSON.stringify(metadata)}::jsonb,
      metadata_status = 'ready',
      last_processing_error = NULL
    WHERE id = ${id}
  `);
}

// Increment embedding retry count, set error, mark failed if terminal
export async function incrementEmbeddingRetry(
  id: string,
  processingError: string,
): Promise<void> {
  const sql = getDb();

  await run('increment embedding retry', () => sql`
    UPDATE memories SET
      retry_count_embedding = retry_count_embedding + 1,
      last_processing_error = ${processingError},
      embedding_status = CASE
        WHEN retry_count_embedding + 1 >= ${MAX_EMBEDDING_RETRIES} THEN 'failed'
        ELSE embedding_status
      END
    WHERE id = ${id}
  `);
}

// Increment metadata retry count, set error, mark failed if terminal
export async function incrementMetadataRetry(
  id: string,
  processingError: string,
): Promise<void> {
  const sql = getDb();

  await run('increment metadata retry', () => sql`
    UPDATE memories SET
      retry_count_metadata = retry_count_metadata + 1,
      last_processing_error = ${processingError},
      metadata_status = CASE
        WHEN retry_count_metadata + 1 >= ${MAX_METADATA_RETRIES} THEN 'failed'
        ELSE metadata_status
      END
    WHERE id = ${id}
  `);
}
