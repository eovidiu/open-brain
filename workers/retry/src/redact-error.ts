// Strip potentially sensitive data (API keys) from upstream error bodies
// before they are persisted to memories.last_processing_error.
export function redactError(message: string): string {
  return message
    .replace(/sk-[a-zA-Z0-9_-]+/g, 'sk-***')
    .replace(/key["\s:=]+[a-zA-Z0-9_-]{10,}/gi, 'key=***')
    .slice(0, 200);
}

export function toErrorMessage(err: unknown): string {
  return redactError(err instanceof Error ? err.message : String(err));
}
