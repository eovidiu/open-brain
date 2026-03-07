import { captureMemory, CaptureValidationError, DbWriteError } from '../services/capture.js';
import type { CaptureResponse, MemorySource } from '../types.js';

export async function handleCaptureMemory(params: {
  text: string;
  source?: MemorySource;
}): Promise<CaptureResponse> {
  return captureMemory(params.text, params.source ?? 'mcp_direct');
}

export { CaptureValidationError, DbWriteError };
