import { getStats } from '../db/queries.js';
import type { StatsResponse } from '../types.js';

export async function handleGetStats(): Promise<StatsResponse> {
  return getStats();
}
