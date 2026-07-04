import { DEGRADED_METADATA, extractMetadata, validateMetadata } from './metadata.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function openAiResponse(content: string) {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
}

function anthropicResponse(text: string) {
  return { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) };
}

describe('validateMetadata', () => {
  it('passes through a fully valid object', () => {
    const raw = {
      type: 'insight',
      topics: ['a', 'b'],
      people: ['carol'],
      action_items: ['follow up'],
      confidence: 0.75,
      sentiment: 'positive',
    };
    expect(validateMetadata(raw)).toEqual({
      type: 'insight',
      topics: ['a', 'b'],
      people: ['carol'],
      action_items: ['follow up'],
      confidence: 0.75,
      truncated: false,
      sentiment: 'positive',
    });
  });

  it('defaults an unrecognized type to unknown', () => {
    const result = validateMetadata({ type: 'not-a-real-type' });
    expect(result?.type).toBe('unknown');
  });

  it('drops sentiment when not one of the valid enum values', () => {
    const result = validateMetadata({ type: 'note', sentiment: 'ecstatic' });
    expect(result?.sentiment).toBeUndefined();
  });

  it('clamps confidence to the 0-1 range', () => {
    expect(validateMetadata({ type: 'note', confidence: 5 })?.confidence).toBe(1);
    expect(validateMetadata({ type: 'note', confidence: -5 })?.confidence).toBe(0);
    expect(validateMetadata({ type: 'note', confidence: 'high' })?.confidence).toBe(0);
  });

  it('filters non-string items and caps arrays at 50', () => {
    const topics = Array.from({ length: 60 }, (_, i) => `topic-${i}`);
    const result = validateMetadata({ type: 'note', topics: [...topics, 123, null] });
    expect(result?.topics).toHaveLength(50);
    expect(result?.topics.every((t) => typeof t === 'string')).toBe(true);
  });

  it('returns empty arrays when fields are missing', () => {
    const result = validateMetadata({ type: 'note' });
    expect(result).toMatchObject({ topics: [], people: [], action_items: [] });
  });

  it('returns null for a non-object input', () => {
    expect(validateMetadata(null as unknown as Record<string, unknown>)).toBeNull();
  });
});

describe('extractMetadata', () => {
  const config = { provider: 'openai', openaiApiKey: 'sk-test' };

  it('extracts and validates metadata from the OpenAI provider (default)', async () => {
    mockFetch.mockResolvedValue(
      openAiResponse(JSON.stringify({ type: 'decision', topics: ['x'], confidence: 0.9 })),
    );

    const result = await extractMetadata('some text', config);

    expect(result).toMatchObject({ type: 'decision', topics: ['x'], confidence: 0.9 });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.anything(),
    );
  });

  it('extracts metadata from the Anthropic provider when selected', async () => {
    mockFetch.mockResolvedValue(anthropicResponse(JSON.stringify({ type: 'task', confidence: 0.5 })));

    const result = await extractMetadata('some text', { provider: 'anthropic', anthropicApiKey: 'sk-ant' });

    expect(result).toMatchObject({ type: 'task', confidence: 0.5 });
    expect(mockFetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.anything());
  });

  it('prefers openaiMetadataApiKey over openaiApiKey', async () => {
    mockFetch.mockResolvedValue(openAiResponse(JSON.stringify({ type: 'note' })));

    await extractMetadata('some text', {
      provider: 'openai',
      openaiApiKey: 'sk-general',
      openaiMetadataApiKey: 'sk-metadata',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk-metadata' }) }),
    );
  });

  it('strips markdown code fences from the LLM response', async () => {
    mockFetch.mockResolvedValue(openAiResponse('```json\n{"type":"note","confidence":0.4}\n```'));

    const result = await extractMetadata('some text', config);

    expect(result).toMatchObject({ type: 'note', confidence: 0.4 });
  });

  it('returns null when the LLM response is not valid JSON', async () => {
    mockFetch.mockResolvedValue(openAiResponse('not json at all'));

    const result = await extractMetadata('some text', config);

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Metadata extraction failed'));
  });

  it('returns null when the LLM response fails validation', async () => {
    mockFetch.mockResolvedValue(openAiResponse('null'));

    const result = await extractMetadata('some text', config);

    expect(result).toBeNull();
  });

  it('returns null when the LLM call itself returns nothing', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ choices: [] }) });

    const result = await extractMetadata('some text', config);

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('LLM returned null'));
  });

  it('returns null when the provider call rejects', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    const result = await extractMetadata('some text', config);

    expect(result).toBeNull();
  });

  it('returns null when no OpenAI key is configured for metadata', async () => {
    const result = await extractMetadata('some text', { provider: 'openai' });

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No OpenAI API key'));
  });

  it('returns null when no Anthropic key is configured', async () => {
    const result = await extractMetadata('some text', { provider: 'anthropic' });

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('ANTHROPIC_API_KEY not configured'));
  });

  it('returns null when the Anthropic call responds with a non-ok status', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const result = await extractMetadata('some text', { provider: 'anthropic', anthropicApiKey: 'sk-ant' });

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Anthropic API error: status=500'));
  });

  it('marks truncated when the input exceeds the truncation length', async () => {
    mockFetch.mockResolvedValue(openAiResponse(JSON.stringify({ type: 'note' })));

    const longText = 'a'.repeat(24_001);
    const result = await extractMetadata(longText, config);

    expect(result?.truncated).toBe(true);
  });
});

describe('DEGRADED_METADATA', () => {
  it('is the unknown/zero-confidence fallback shape', () => {
    expect(DEGRADED_METADATA).toEqual({
      type: 'unknown',
      topics: [],
      people: [],
      action_items: [],
      confidence: 0,
      truncated: false,
    });
  });
});
