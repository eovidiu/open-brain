import type { Db } from 'open-brain-workers-shared';
import { getStats } from '../db.js';
import type { StatsResponse } from '../types.js';

export async function handleGetStats(sql: Db): Promise<StatsResponse> {
  return getStats(sql);
}
