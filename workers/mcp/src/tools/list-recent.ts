import type { Db } from 'open-brain-workers-shared';
import { listRecentMemories } from '../db.js';

function escapeXmlTags(text: string): string {
  return text.replace(/<\/?memory_content>/g, (match) => match.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
}

export async function handleListRecent(
  sql: Db,
  params: { n?: number; filter_type?: string; wrap_output?: boolean },
) {
  const n = Math.min(Math.max(params.n ?? 20, 1), 100);
  const memories = await listRecentMemories(sql, n, params.filter_type);

  return memories.map((memory) => {
    if (params.wrap_output) {
      return { ...memory, raw_text: `<memory_content>\n${escapeXmlTags(memory.raw_text)}\n</memory_content>` };
    }
    return memory;
  });
}
