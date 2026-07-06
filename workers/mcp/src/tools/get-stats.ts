import type { Db } from 'open-brain-workers-shared';
import { getStats, type StatsResponse } from 'open-brain-workers-shared';

export async function handleGetStats(sql: Db): Promise<StatsResponse> {
  return getStats(sql);
}
