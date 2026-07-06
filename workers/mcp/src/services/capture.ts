// capture_memory orchestration, ported from mcp-server/src/services/capture.ts.
// Duplicates the same embedding + metadata + insert flow already ported
// separately into workers/capture/ (F004) — the two Workers are scope-
// isolated siblings, not shared code, so each ports the source faithfully
// on its own.
import {
  extractMetadata,
  fetchEmbedding,
  insertMemory,
  DEGRADED_METADATA,
  type Db,
  type InsertMemoryRecord,
  type MemorySource,
  type MetadataConfig,
} from 'open-brain-workers-shared';
import type { CaptureResult, EmbeddingStatus } from 'open-brain-workers-shared';

const VALID_SOURCES: MemorySource[] = ['slack', 'claude', 'chatgpt', 'mcp_direct', 'api'];

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

export interface CaptureConfig {
  apiKey: string | undefined;
  metadataConfig: MetadataConfig;
}

export async function captureMemory(
  sql: Db,
  text: string,
  source: MemorySource | undefined,
  config: CaptureConfig,
): Promise<CaptureResult> {
  const trimmed = text?.trim();
  if (!trimmed || trimmed.length === 0 || trimmed.length > 10_000) {
    throw new CaptureValidationError('INVALID_TEXT', 'text must be 1-10000 characters');
  }

  const resolvedSource = source ?? 'mcp_direct';
  if (!VALID_SOURCES.includes(resolvedSource)) {
    throw new CaptureValidationError('INVALID_SOURCE', `source must be one of: ${VALID_SOURCES.join(', ')}`);
  }

  const [embeddingResult, metadataResult] = await Promise.allSettled([
    fetchEmbedding(text, config.apiKey),
    extractMetadata(text, config.metadataConfig),
  ]);

  if (embeddingResult.status === 'rejected') {
    console.error(`[capture] Embedding rejected: ${embeddingResult.reason}`);
  }
  if (metadataResult.status === 'rejected') {
    console.error(`[capture] Metadata rejected: ${metadataResult.reason}`);
  }

  const embedding = embeddingResult.status === 'fulfilled' ? embeddingResult.value : null;
  const embeddingStatus: EmbeddingStatus = embedding ? 'ready' : 'pending';

  const metadata = metadataResult.status === 'fulfilled' ? metadataResult.value : DEGRADED_METADATA;
  const metadataStatus: 'ready' | 'degraded' =
    metadataResult.status === 'fulfilled' ? 'ready' : 'degraded';

  const record: InsertMemoryRecord = {
    id: crypto.randomUUID(),
    raw_text: text,
    embedding,
    embedding_status: embeddingStatus,
    metadata,
    metadata_status: metadataStatus,
    captured_at: new Date().toISOString(),
    source: resolvedSource,
  };

  try {
    return await insertMemory(sql, record);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown DB error';
    throw new DbWriteError(message);
  }
}
