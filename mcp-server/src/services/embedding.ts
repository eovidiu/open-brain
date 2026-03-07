import OpenAI from 'openai';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY must be set');
  }
  client = new OpenAI({ apiKey });
  return client;
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const openai = getClient();
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      dimensions: 1536,
    });
    return response.data[0]?.embedding ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown embedding error';
    console.error(`[embedding] Failed to generate embedding: ${message}`);
    return null;
  }
}
