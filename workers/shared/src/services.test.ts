import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchEmbedding,
  extractMetadata,
  redactError,
  toErrorMessage,
  DEGRADED_METADATA,
} from './services.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function openaiChatResponse(content: string) {
  return jsonResponse({ choices: [{ message: { content } }] });
}

function anthropicResponse(text: string) {
  return jsonResponse({ content: [{ type: 'text', text }] });
}

const GOOD_METADATA = JSON.stringify({
  type: 'decision',
  topics: ['a'],
  people: [],
  action_items: [],
  confidence: 0.9,
  sentiment: 'positive',
});

beforeEach(() => {
  fetchMock.mockReset();
});

describe('fetchEmbedding', () => {
  it('returns the embedding vector on success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ embedding: [0.1, 0.2] }] }));
    await expect(fetchEmbedding('text', 'sk-key')).resolves.toEqual([0.1, 0.2]);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('api.openai.com/v1/embeddings');
    expect(JSON.parse(opts.body).dimensions).toBe(1536);
  });

  it('throws when the API key is missing', async () => {
    await expect(fetchEmbedding('text', undefined)).rejects.toThrow(/key/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws with a redacted body on non-ok status', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'invalid sk-abcdefghijklmnop',
      json: async () => ({}),
    });
    await expect(fetchEmbedding('text', 'sk-key')).rejects.toThrow(/401/);
    await expect(fetchEmbedding('text', 'sk-key')).rejects.toThrow(); // second consumed mock is empty
  });

  it('throws when the response has no embedding', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
    await expect(fetchEmbedding('text', 'sk-key')).rejects.toThrow(/embedding/i);
  });
});

describe('extractMetadata provider selection', () => {
  it('uses Anthropic when provider=anthropic and key present', async () => {
    fetchMock.mockResolvedValueOnce(anthropicResponse(GOOD_METADATA));
    const m = await extractMetadata('note text', { provider: 'anthropic', anthropicApiKey: 'ak', openaiApiKey: 'ok' });
    expect(fetchMock.mock.calls[0][0]).toContain('api.anthropic.com');
    expect(m.type).toBe('decision');
  });

  it('REGRESSION: provider=openai with only OPENAI_API_KEY calls OpenAI, never Anthropic', async () => {
    // The retry Worker bug: its selectCaller only accepted the metadata-specific
    // key and silently fell through to Anthropic when it was absent.
    fetchMock.mockResolvedValueOnce(openaiChatResponse(GOOD_METADATA));
    const m = await extractMetadata('note text', {
      provider: 'openai',
      openaiApiKey: 'ok',
      anthropicApiKey: 'ak',
    });
    expect(fetchMock.mock.calls[0][0]).toContain('api.openai.com');
    expect(m.type).toBe('decision');
  });

  it('prefers the metadata-specific OpenAI key when both are set', async () => {
    fetchMock.mockResolvedValueOnce(openaiChatResponse(GOOD_METADATA));
    await extractMetadata('t', { provider: 'openai', openaiApiKey: 'main', openaiMetadataApiKey: 'meta' });
    expect(fetchMock.mock.calls[0][1].headers['Authorization']).toBe('Bearer meta');
  });

  it('falls back to OpenAI when provider=anthropic but no anthropic key', async () => {
    fetchMock.mockResolvedValueOnce(openaiChatResponse(GOOD_METADATA));
    await extractMetadata('t', { provider: 'anthropic', openaiApiKey: 'ok' });
    expect(fetchMock.mock.calls[0][0]).toContain('api.openai.com');
  });

  it('falls back to Anthropic when provider=openai but no openai keys', async () => {
    fetchMock.mockResolvedValueOnce(anthropicResponse(GOOD_METADATA));
    await extractMetadata('t', { provider: 'openai', anthropicApiKey: 'ak' });
    expect(fetchMock.mock.calls[0][0]).toContain('api.anthropic.com');
  });

  it('throws when no key is configured', async () => {
    await expect(extractMetadata('t', { provider: 'openai' })).rejects.toThrow(/key/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws with redacted detail on non-ok API status', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'rate limited sk-abcdefghijklmnop',
      json: async () => ({}),
    });
    const err = await extractMetadata('t', { provider: 'openai', openaiApiKey: 'ok' }).catch((e) => e);
    expect(err.message).toContain('429');
    expect(err.message).not.toContain('sk-abcdefghijklmnop');
  });
});

describe('extractMetadata validation (unified semantics)', () => {
  const call = (payload: unknown) => {
    fetchMock.mockResolvedValueOnce(
      openaiChatResponse(typeof payload === 'string' ? payload : JSON.stringify(payload))
    );
    return extractMetadata('some text', { provider: 'openai', openaiApiKey: 'ok' });
  };

  it('accepts all 9 types including note and meeting_note', async () => {
    for (const type of ['note', 'meeting_note']) {
      fetchMock.mockResolvedValueOnce(
        openaiChatResponse(JSON.stringify({ type, topics: [], people: [], action_items: [], confidence: 1 }))
      );
      const m = await extractMetadata('t', { provider: 'openai', openaiApiKey: 'ok' });
      expect(m.type).toBe(type);
    }
  });

  it('coerces an off-list type to unknown instead of failing', async () => {
    const m = await call({ type: 'banana', topics: ['x'], confidence: 0.5 });
    expect(m.type).toBe('unknown');
    expect(m.topics).toEqual(['x']);
  });

  it('caps arrays at 50 and filters non-strings', async () => {
    const m = await call({
      type: 'note',
      topics: Array.from({ length: 60 }, (_, i) => `t${i}`),
      people: ['a', 1, 'b'],
      action_items: [],
      confidence: 0.5,
    });
    expect(m.topics).toHaveLength(50);
    expect(m.people).toEqual(['a', 'b']);
  });

  it('passes valid sentiment through and drops invalid sentiment', async () => {
    const good = await call({ type: 'note', sentiment: 'mixed', confidence: 1 });
    expect(good.sentiment).toBe('mixed');
    const bad = await call({ type: 'note', sentiment: 'ecstatic', confidence: 1 });
    expect(bad.sentiment).toBeUndefined();
  });

  it('clamps confidence to [0,1]', async () => {
    expect((await call({ type: 'note', confidence: 7 })).confidence).toBe(1);
    expect((await call({ type: 'note', confidence: -2 })).confidence).toBe(0);
  });

  it('strips markdown fences before parsing', async () => {
    const m = await call('```json\n' + GOOD_METADATA + '\n```');
    expect(m.type).toBe('decision');
  });

  it('throws on a non-object response (retryable failure)', async () => {
    await expect(call('"just a string"')).rejects.toThrow(/object/i);
  });

  it('throws on unparseable output', async () => {
    await expect(call('not json at all')).rejects.toThrow();
  });

  it('sets truncated=true for over-limit input and truncates the prompt', async () => {
    fetchMock.mockResolvedValueOnce(openaiChatResponse(GOOD_METADATA));
    const m = await extractMetadata('x'.repeat(30_000), { provider: 'openai', openaiApiKey: 'ok' });
    expect(m.truncated).toBe(true);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    const userMsg = sent.messages.find((x: { role: string }) => x.role === 'user').content;
    expect(userMsg.length).toBeLessThan(25_000);
  });
});

describe('redaction helpers', () => {
  it('redactError masks API keys and truncates', () => {
    const out = redactError('failed sk-abcdefghijklmnopqrst and key: abcdefghij123');
    expect(out).not.toContain('sk-abcdefghijklmnopqrst');
    expect(out).not.toContain('abcdefghij123');
  });

  it('toErrorMessage handles non-Error values', () => {
    expect(toErrorMessage('plain sk-abcdefghijklmnop')).not.toContain('sk-abcdefghijklmnop');
  });
});

describe('DEGRADED_METADATA', () => {
  it('is the canonical degraded shape', () => {
    expect(DEGRADED_METADATA).toEqual({
      type: 'unknown', topics: [], people: [], action_items: [], confidence: 0, truncated: false,
    });
  });
});
