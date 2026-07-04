import { extractMetadata } from './metadata-service.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

function anthropicResponse(text: string) {
  return { ok: true, json: async () => ({ content: [{ text }] }) };
}

function openaiResponse(content: string) {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
}

const VALID_JSON = JSON.stringify({
  type: 'insight',
  topics: ['workers'],
  people: ['Ovidiu'],
  action_items: [],
  confidence: 0.9,
});

describe('extractMetadata', () => {
  it('calls Anthropic when provider is anthropic and a key is set', async () => {
    fetchMock.mockResolvedValue(anthropicResponse(VALID_JSON));

    const metadata = await extractMetadata('some text', 'anthropic', 'anthropic-key', null);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'anthropic-key' }) }),
    );
    expect(metadata).toEqual({
      type: 'insight',
      topics: ['workers'],
      people: ['Ovidiu'],
      action_items: [],
      confidence: 0.9,
      truncated: false,
    });
  });

  it('strips markdown fences from the Anthropic response', async () => {
    fetchMock.mockResolvedValue(anthropicResponse('```json\n' + VALID_JSON + '\n```'));

    const metadata = await extractMetadata('some text', 'anthropic', 'anthropic-key', null);

    expect(metadata.type).toBe('insight');
  });

  it('falls back to OpenAI when the provider is not anthropic and an OpenAI key exists', async () => {
    fetchMock.mockResolvedValue(openaiResponse(VALID_JSON));

    await extractMetadata('some text', 'openai', null, 'openai-metadata-key');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer openai-metadata-key' }) }),
    );
  });

  it('falls back to Anthropic when provider is openai but no OpenAI key is configured', async () => {
    fetchMock.mockResolvedValue(anthropicResponse(VALID_JSON));

    await extractMetadata('some text', 'openai', 'anthropic-key', null);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.anything(),
    );
  });

  it('throws when no metadata LLM key is configured', async () => {
    await expect(extractMetadata('text', 'anthropic', null, null)).rejects.toThrow(
      'No metadata LLM API key configured',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks truncated when raw text exceeds the limit', async () => {
    fetchMock.mockResolvedValue(anthropicResponse(VALID_JSON));
    const longText = 'x'.repeat(24_001);

    const metadata = await extractMetadata(longText, 'anthropic', 'key', null);

    expect(metadata.truncated).toBe(true);
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const inner = sentBody.messages[0].content
      .replace(/^<user_input>\n/, '')
      .replace(/\n<\/user_input>$/, '');
    expect(inner).toHaveLength(24_000);
  });

  it('rejects a response with an invalid type', async () => {
    fetchMock.mockResolvedValue(anthropicResponse(JSON.stringify({ type: 'not-a-type' })));

    await expect(extractMetadata('text', 'anthropic', 'key', null)).rejects.toThrow(
      'invalid or missing type',
    );
  });

  it('rejects a non-object response', async () => {
    fetchMock.mockResolvedValue(anthropicResponse('"just a string"'));

    await expect(extractMetadata('text', 'anthropic', 'key', null)).rejects.toThrow(
      'not a JSON object',
    );
  });

  it('clamps an out-of-range confidence value', async () => {
    fetchMock.mockResolvedValue(
      anthropicResponse(JSON.stringify({ type: 'task', topics: [], people: [], action_items: [], confidence: 5 })),
    );

    const metadata = await extractMetadata('text', 'anthropic', 'key', null);

    expect(metadata.confidence).toBe(1);
  });

  it('defaults topics/people/action_items to [] and confidence to 0 when missing', async () => {
    fetchMock.mockResolvedValue(anthropicResponse(JSON.stringify({ type: 'unknown' })));

    const metadata = await extractMetadata('text', 'anthropic', 'key', null);

    expect(metadata).toMatchObject({
      topics: [],
      people: [],
      action_items: [],
      confidence: 0,
    });
  });

  it('throws a redacted error on a non-ok Anthropic response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'server error key: abcdefghijklmnop',
    });

    await expect(extractMetadata('text', 'anthropic', 'key', null)).rejects.toThrow(
      'Anthropic API 500: server error key=***',
    );
  });

  it('throws a redacted error on a non-ok OpenAI response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'server error sk-realsecretvalue000',
    });

    await expect(extractMetadata('text', 'openai', null, 'oai-key')).rejects.toThrow(
      'OpenAI chat API 500: server error sk-***',
    );
  });
});
