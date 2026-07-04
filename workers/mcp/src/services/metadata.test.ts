import { extractMetadata } from './metadata.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const GOOD_LLM_JSON = JSON.stringify({
  type: 'insight',
  topics: ['testing'],
  people: [],
  action_items: [],
  confidence: 0.9,
  sentiment: 'neutral',
});

function mockAnthropicResponse(text: string, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status: 500,
    json: async () => ({ content: [{ type: 'text', text }] }),
  }) as unknown as typeof fetch;
}

function mockOpenAIResponse(text: string, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status: 500,
    json: async () => ({ choices: [{ message: { content: text } }] }),
  }) as unknown as typeof fetch;
}

describe('extractMetadata', () => {
  it('defaults to the anthropic provider', async () => {
    mockAnthropicResponse(GOOD_LLM_JSON);

    const result = await extractMetadata('hello world', { anthropicApiKey: 'key' });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.anything(),
    );
    expect(result.status).toBe('ready');
    expect(result.metadata.type).toBe('insight');
  });

  it('uses openai when provider=openai', async () => {
    mockOpenAIResponse(GOOD_LLM_JSON);

    const result = await extractMetadata('hello world', { provider: 'openai', openaiApiKey: 'key' });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.anything(),
    );
    expect(result.status).toBe('ready');
  });

  it('strips markdown fences before parsing', async () => {
    mockAnthropicResponse('```json\n' + GOOD_LLM_JSON + '\n```');

    const result = await extractMetadata('hello world', { anthropicApiKey: 'key' });

    expect(result.status).toBe('ready');
    expect(result.metadata.type).toBe('insight');
  });

  it('returns degraded metadata when the LLM response fails validation', async () => {
    mockAnthropicResponse(JSON.stringify({ not: 'valid' }));

    const result = await extractMetadata('hello world', { anthropicApiKey: 'key' });

    expect(result.status).toBe('degraded');
    expect(result.metadata.type).toBe('unknown');
  });

  it('returns degraded metadata when the API call fails', async () => {
    mockAnthropicResponse('', false);

    const result = await extractMetadata('hello world', { anthropicApiKey: 'key' });

    expect(result.status).toBe('degraded');
  });

  it('returns degraded metadata when no API key is configured', async () => {
    const result = await extractMetadata('hello world', {});

    expect(result.status).toBe('degraded');
  });

  it('returns degraded metadata when the LLM response is not valid JSON', async () => {
    mockAnthropicResponse('not json at all');

    const result = await extractMetadata('hello world', { anthropicApiKey: 'key' });

    expect(result.status).toBe('degraded');
  });

  it('marks truncated=true when input exceeds the truncation length', async () => {
    mockAnthropicResponse(GOOD_LLM_JSON);
    const longText = 'a'.repeat(25_000);

    const result = await extractMetadata(longText, { anthropicApiKey: 'key' });

    expect(result.metadata.truncated).toBe(true);
  });
});
