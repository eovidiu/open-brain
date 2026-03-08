import { generateEmbedding } from '../services/embedding.js';
import { searchMemories } from '../db/queries.js';
import type { SearchResult } from '../types.js';

function escapeXmlTags(text: string): string {
  return text.replace(/<\/?memory_content>/g, (match) =>
    match.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  );
}

export async function handleSearchBrain(params: {
  query: string;
  n?: number;
  filter_type?: string;
  since?: string;
  wrap_output?: boolean;
}): Promise<SearchResult[]> {
  const n = Math.min(Math.max(params.n ?? 10, 1), 50);

  const queryVector = await generateEmbedding(params.query);
  if (!queryVector) {
    throw new Error('Failed to generate embedding for search query');
  }

  const results = await searchMemories(queryVector, n, params.filter_type, params.since);

  if (params.wrap_output) {
    return results.map((r) => ({
      ...r,
      raw_text: `<memory_content>\n${escapeXmlTags(r.raw_text)}\n</memory_content>`,
    }));
  }

  return results;
}
