import { fetchEmbedding } from './embedding.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('fetchEmbedding', () => {
  it('returns the embedding vector on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    });

    const result = await fetchEmbedding('hello world', 'sk-test');

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
      }),
    );
  });

  it('returns null when the API key is missing', async () => {
    const result = await fetchEmbedding('hello world', undefined);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('OPENAI_API_KEY'));
  });

  it('returns null on a non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const result = await fetchEmbedding('hello world', 'sk-test');

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('status=500'));
  });

  it('returns null when the response has no embedding data', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    const result = await fetchEmbedding('hello world', 'sk-test');

    expect(result).toBeNull();
  });
});
