// Row-normalization and error-sanitization helpers used by every query module.

export function sanitizeDbError(context: string, error: { message: string }): Error {
  console.error(`[db] ${context}: ${error.message}`);
  return new Error(`Database operation failed: ${context}`);
}

export async function run<T>(context: string, query: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (error) {
    throw sanitizeDbError(context, error as Error);
  }
}

// timestamptz values arrive as Date (driver-parsed) or string; normalize to ISO
export function toIso(value: unknown): string {
  return new Date(value as string | Date).toISOString();
}

// vector columns arrive as their text form, e.g. "[0.1,0.2]"
export function parseVector(value: unknown): number[] | null {
  if (value == null) return null;
  return typeof value === 'string' ? (JSON.parse(value) as number[]) : (value as number[]);
}
