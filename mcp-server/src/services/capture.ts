import crypto from 'node:crypto';
import type { CaptureResponse, MemorySource, EmbeddingStatus, MetadataStatus } from '../types.js';
import { DEGRADED_METADATA, VALID_SOURCES } from '../types.js';
import { generateEmbedding } from './embedding.js';
import { extractMetadata } from './metadata.js';
import { insertMemory } from '../db/queries.js';

export class CaptureValidationError extends Error {
  constructor(
    public code: 'INVALID_TEXT' | 'INVALID_SOURCE',
    message: string,
  ) {
    super(message);
    this.name = 'CaptureValidationError';
  }
}

export class DbWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbWriteError';
  }
}

export async function captureMemory(
  text: string,
  source: MemorySource = 'api',
): Promise<CaptureResponse> {
  const trimmed = text?.trim();
  if (!trimmed || trimmed.length === 0 || trimmed.length > 10_000) {
    throw new CaptureValidationError('INVALID_TEXT', 'text must be 1-10000 characters');
  }

  if (!VALID_SOURCES.includes(source)) {
    throw new CaptureValidationError('INVALID_SOURCE', `source must be one of: ${VALID_SOURCES.join(', ')}`);
  }

  // Run embedding and metadata extraction in parallel
  const [embeddingResult, metadataResult] = await Promise.allSettled([
    generateEmbedding(text),
    extractMetadata(text),
  ]);

  if (embeddingResult.status === 'rejected') {
    console.error(`[capture] Embedding rejected: ${embeddingResult.reason}`);
  }
  if (metadataResult.status === 'rejected') {
    console.error(`[capture] Metadata rejected: ${metadataResult.reason}`);
  }

  const embedding = embeddingResult.status === 'fulfilled' ? embeddingResult.value : null;
  const embeddingStatus: EmbeddingStatus = embedding ? 'ready' : 'pending';

  const { metadata, status: metadataStatus } =
    metadataResult.status === 'fulfilled'
      ? metadataResult.value
      : { metadata: DEGRADED_METADATA, status: 'degraded' as MetadataStatus };

  const id = crypto.randomUUID();
  const capturedAt = new Date().toISOString();

  try {
    return await insertMemory({
      id,
      raw_text: text,
      embedding,
      embedding_status: embeddingStatus,
      metadata,
      metadata_status: metadataStatus,
      captured_at: capturedAt,
      source,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown DB error';
    throw new DbWriteError(message);
  }
}
