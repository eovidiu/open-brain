import { createClient } from '@supabase/supabase-js';

export async function validateSupabase(url: string, key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = createClient(url, key);
    const { error } = await client.from('_openbrain_health_check').select('*').limit(0);
    // A 404 (relation does not exist) with service role still means the connection works.
    // Only auth errors (401/403) indicate bad credentials.
    if (error && error.code === 'PGRST301') {
      // Unauthorized — bad key
      return { ok: false, error: `Authentication failed: ${error.message}` };
    }
    // Any other error (including "relation does not exist") means we connected successfully.
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
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
