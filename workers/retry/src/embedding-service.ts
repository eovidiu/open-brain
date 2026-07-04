import { redactError } from './redact-error.js';

const EMBEDDING_URL = 'https://api.openai.com/v1/embeddings';
const EMBEDDING_MODEL = 'text-embedding-3-small';

export async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch(EMBEDDING_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI embedding API ${response.status}: ${redactError(body)}`);
  }

  const json = (await response.json()) as { data: Array<{ embedding: number[] }> };
  return json.data[0].embedding;
}
