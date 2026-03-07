import { listRecentMemories } from '../db/queries.js';

export async function handleListRecent(params: {
  n?: number;
  filter_type?: string;
}) {
  const n = Math.min(Math.max(params.n ?? 20, 1), 100);
  const memories = await listRecentMemories(n, params.filter_type);

  return memories.map(({ embedding, retry_count_embedding, retry_count_metadata, last_processing_error, ...rest }) => rest);
}
