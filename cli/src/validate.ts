import { neon } from '@neondatabase/serverless';

export async function validateNeon(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const sql = neon(url);
    await sql`SELECT 1`;
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: redactDatabaseUrl(message) };
  }
}

function redactDatabaseUrl(text: string): string {
  return text.replace(/(postgres(?:ql)?:\/\/[^:/\s]+):[^@\s]+@/g, '$1:***REDACTED***@');
}

export async function validateOpenAIKey(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: 'test',
        dimensions: 1536,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, error: `${response.status} ${response.statusText}: ${redactKey(body)}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function validateAnthropicKey(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, error: `${response.status} ${response.statusText}: ${redactKey(body)}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function redactKey(text: string): string {
  // Redact anything that looks like an API key
  return text.replace(/(?:sk-|eyJ)[A-Za-z0-9_-]{20,}/g, '***REDACTED***');
}
