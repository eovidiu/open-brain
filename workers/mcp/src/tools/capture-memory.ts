import type { Db, CaptureResult, MemorySource } from 'open-brain-workers-shared';
import { captureMemory, CaptureValidationError, DbWriteError, type CaptureConfig } from '../services/capture.js';

export async function handleCaptureMemory(
  sql: Db,
  config: CaptureConfig,
  params: { text: string; source?: MemorySource },
): Promise<CaptureResult> {
  return captureMemory(sql, params.text, params.source, config);
}

export { CaptureValidationError, DbWriteError };
