import { fetchEmbedding } from './embedding.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('fetchEmbedding', () => {
  it('returns null and logs when apiKey is missing', async () => {
    const result = await fetchEmbedding('hello', undefined);
    expect(result).toBeNull();
  });

  it('returns the embedding vector on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    }) as unknown as typeof fetch;

    const result = await fetchEmbedding('hello', 'sk-test');

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
      }),
    );
  });

  it('returns null when the API responds with a non-ok status', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;

    const result = await fetchEmbedding('hello', 'sk-test');

    expect(result).toBeNull();
  });

  it('returns null when the response has no embedding data', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch;

    const result = await fetchEmbedding('hello', 'sk-test');

    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const result = await fetchEmbedding('hello', 'sk-test');

    expect(result).toBeNull();
  });
});
