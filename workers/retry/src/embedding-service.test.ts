import { generateEmbedding } from './embedding-service.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

describe('generateEmbedding', () => {
  it('calls the OpenAI embeddings endpoint and returns the vector', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    });

    const vector = await generateEmbedding('hello world', 'sk-test-key');

    expect(vector).toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test-key' }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ model: 'text-embedding-3-small', input: 'hello world' });
  });

  it('throws a redacted error on a non-ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid api key sk-realsecretvalue000',
    });

    await expect(generateEmbedding('text', 'sk-bad')).rejects.toThrow(
      'OpenAI embedding API 401: invalid api key sk-***',
    );
  });
});
