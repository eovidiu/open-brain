// OpenAI embedding fetch, ported from mcp-server/src/services/embedding.ts.
// Uses raw fetch (no openai SDK) and takes the API key as a parameter —
// Workers receive config via env bindings, not process.env.
export async function fetchEmbedding(text: string, apiKey: string | undefined): Promise<number[] | null> {
  if (!apiKey) {
    console.error('[embedding] OPENAI_API_KEY not configured');
    return null;
  }

  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
        dimensions: 1536,
      }),
    });

    if (!res.ok) {
      console.error(`[embedding] Embedding API error: status=${res.status}`);
      return null;
    }

    const data = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    return data?.data?.[0]?.embedding ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown embedding error';
    console.error(`[embedding] Failed to generate embedding: ${message}`);
    return null;
  }
}
