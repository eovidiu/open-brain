// OpenAI embedding fetch, ported from supabase/functions/capture/index.ts.
// The API key is passed in (Workers receive config via env bindings, not
// process.env/Deno.env), rather than read from a global at call time.

export async function fetchEmbedding(text: string, apiKey: string | undefined): Promise<number[] | null> {
  if (!apiKey) {
    console.error('[capture] OPENAI_API_KEY not configured');
    return null;
  }

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  if (!res.ok) {
    console.error(`[capture] Embedding API error: status=${res.status}`);
    return null;
  }

  const data = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
  return data?.data?.[0]?.embedding ?? null;
}
