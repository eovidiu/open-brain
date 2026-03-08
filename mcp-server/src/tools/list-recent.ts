import { listRecentMemories } from '../db/queries.js';

function escapeXmlTags(text: string): string {
  return text.replace(/<\/?memory_content>/g, (match) =>
    match.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  );
}

export async function handleListRecent(params: {
  n?: number;
  filter_type?: string;
  wrap_output?: boolean;
}) {
  const n = Math.min(Math.max(params.n ?? 20, 1), 100);
  const memories = await listRecentMemories(n, params.filter_type);

  return memories.map(({ embedding, retry_count_embedding, retry_count_metadata, last_processing_error, ...rest }) => {
    if (params.wrap_output) {
      return { ...rest, raw_text: `<memory_content>\n${escapeXmlTags(rest.raw_text)}\n</memory_content>` };
    }
    return rest;
  });
}
