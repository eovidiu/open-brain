import { createDb, getRetryEligibleMemories } from 'open-brain-workers-shared';
import { processRecord } from './process-record.js';
import type { Env } from './types.js';

// Eligibility is sourced exclusively from get_retry_eligible_memories() (AD-7);
// there is no fallback query if the SQL function is unavailable.
const BATCH_LIMIT = 20;

export interface RetryBatchSummary {
  processed: number;
  succeeded: number;
  failed: number;
}

function summarize(results: { embedding: string; metadata: string }[]): RetryBatchSummary {
  let succeeded = 0;
  let failed = 0;
  for (const r of results) {
    if (r.embedding === 'success' || r.metadata === 'success') succeeded++;
    if (r.embedding === 'failure' || r.metadata === 'failure') failed++;
  }
  return { processed: results.length, succeeded, failed };
}

export async function runRetryBatch(env: Env): Promise<RetryBatchSummary> {
  const sql = createDb(env.DATABASE_URL);
  const eligible = await getRetryEligibleMemories(sql, BATCH_LIMIT);

  if (eligible.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  const results = await Promise.all(eligible.map((record) => processRecord(sql, record, env)));
  return summarize(results);
}
