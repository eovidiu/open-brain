import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type {
  CaptureResult,
  EmbeddingStatus,
  InsertMemoryRecord,
  MemoryMetadata,
  MemorySource,
  MetadataStatus,
  RetryEligibleMemory,
} from './types.js';

export type Db = NeonQueryFunction<false, false>;

export * from './types.js';
export * from './services.js';
export * from './queries.js';
export { toIso, parseVector } from './db-util.js';

import { run, toIso } from './db-util.js';

const MAX_EMBEDDING_RETRIES = 10;
const MAX_METADATA_RETRIES = 10;

// Workers receive configuration per request via env bindings, so the url is
// passed explicitly instead of being read from process.env.
export function createDb(url: string): Db {
  if (!url) {
    throw new Error('database url is required');
  }
  return neon(url);
}

export async function insertMemory(
  sql: Db,
  record: InsertMemoryRecord,
): Promise<CaptureResult> {
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

export async function getRetryEligibleMemories(
  sql: Db,
  batchLimit: number,
): Promise<RetryEligibleMemory[]> {
  const rows = await run('get retry eligible memories', () => sql`
    SELECT * FROM get_retry_eligible_memories(${batchLimit})
  `);

  return rows.map((row) => ({
    id: row.id as string,
    embedding_status: row.embedding_status as EmbeddingStatus,
    metadata_status: row.metadata_status as MetadataStatus,
    retry_count_embedding: row.retry_count_embedding as number,
    retry_count_metadata: row.retry_count_metadata as number,
    captured_at: toIso(row.captured_at),
    raw_text: row.raw_text as string,
  }));
}

export async function updateMemoryEmbedding(
  sql: Db,
  id: string,
  embedding: number[],
): Promise<void> {
  await run('update embedding', () => sql`
    UPDATE memories SET
      embedding = ${JSON.stringify(embedding)}::vector,
      embedding_status = 'ready',
      last_processing_error = NULL
    WHERE id = ${id}
  `);
}

export async function updateMemoryMetadata(
  sql: Db,
  id: string,
  metadata: MemoryMetadata,
): Promise<void> {
  await run('update metadata', () => sql`
    UPDATE memories SET
      metadata = ${JSON.stringify(metadata)}::jsonb,
      metadata_status = 'ready',
      last_processing_error = NULL
    WHERE id = ${id}
  `);
}

export async function incrementEmbeddingRetry(
  sql: Db,
  id: string,
  processingError: string,
): Promise<void> {
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

export async function incrementMetadataRetry(
  sql: Db,
  id: string,
  processingError: string,
): Promise<void> {
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
