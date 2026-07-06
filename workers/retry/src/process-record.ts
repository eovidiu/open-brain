import {
  extractMetadata,
  fetchEmbedding,
  incrementEmbeddingRetry,
  incrementMetadataRetry,
  toErrorMessage,
  updateMemoryEmbedding,
  updateMemoryMetadata,
  type Db,
  type RetryEligibleMemory,
} from 'open-brain-workers-shared';
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
    const vector = await fetchEmbedding(record.raw_text, env.OPENAI_API_KEY);
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
    const metadata = await extractMetadata(record.raw_text, {
      provider: env.METADATA_LLM_PROVIDER ?? 'anthropic',
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      openaiApiKey: env.OPENAI_API_KEY,
      openaiMetadataApiKey: env.OPENAI_METADATA_API_KEY,
    });
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
