import {
  incrementEmbeddingRetry,
  incrementMetadataRetry,
  updateMemoryEmbedding,
  updateMemoryMetadata,
  type Db,
  type RetryEligibleMemory,
} from 'open-brain-workers-shared';
import { generateEmbedding } from './embedding-service.js';
import { extractMetadata } from './metadata-service.js';
import { toErrorMessage } from './redact-error.js';
import type { Env } from './types.js';

type Outcome = 'success' | 'failure' | 'skipped';

export interface ProcessingResult {
  id: string;
  embedding: Outcome;
  metadata: Outcome;
}

async function retryEmbedding(
  sql: Db,
  record: RetryEligibleMemory,
  env: Env,
): Promise<Outcome> {
  try {
    const vector = await generateEmbedding(record.raw_text, env.OPENAI_API_KEY);
    await updateMemoryEmbedding(sql, record.id, vector);
    return 'success';
  } catch (err) {
    await incrementEmbeddingRetry(sql, record.id, toErrorMessage(err));
    return 'failure';
  }
}

async function retryMetadata(
  sql: Db,
  record: RetryEligibleMemory,
  env: Env,
): Promise<Outcome> {
  try {
    const metadata = await extractMetadata(
      record.raw_text,
      env.METADATA_LLM_PROVIDER ?? 'anthropic',
      env.ANTHROPIC_API_KEY ?? null,
      env.OPENAI_METADATA_API_KEY ?? null,
    );
    await updateMemoryMetadata(sql, record.id, metadata);
    return 'success';
  } catch (err) {
    await incrementMetadataRetry(sql, record.id, toErrorMessage(err));
    return 'failure';
  }
}

// Embedding and metadata retries run independently and in parallel per record,
// matching the retry_count_embedding/retry_count_metadata columns they update.
export async function processRecord(
  sql: Db,
  record: RetryEligibleMemory,
  env: Env,
): Promise<ProcessingResult> {
  const result: ProcessingResult = { id: record.id, embedding: 'skipped', metadata: 'skipped' };
  const tasks: Promise<void>[] = [];

  if (record.embedding_status === 'pending') {
    tasks.push(retryEmbedding(sql, record, env).then((outcome) => {
      result.embedding = outcome;
    }));
  }

  if (record.metadata_status === 'degraded') {
    tasks.push(retryMetadata(sql, record, env).then((outcome) => {
      result.metadata = outcome;
    }));
  }

  await Promise.all(tasks);
  return result;
}
