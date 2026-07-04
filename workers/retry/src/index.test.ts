const { mockRunRetryBatch } = vi.hoisted(() => ({ mockRunRetryBatch: vi.fn() }));
vi.mock('./retry-batch.js', () => ({ runRetryBatch: mockRunRetryBatch }));

import worker from './index.js';

const ENV = { DATABASE_URL: 'postgres://test', OPENAI_API_KEY: 'sk-openai' };

function makeCtx(): ExecutionContext & { waitUntilPromises: Promise<unknown>[] } {
  const waitUntilPromises: Promise<unknown>[] = [];
  return {
    waitUntilPromises,
    waitUntil(promise: Promise<unknown>) {
      waitUntilPromises.push(promise);
    },
    passThroughOnException() {},
  } as unknown as ExecutionContext & { waitUntilPromises: Promise<unknown>[] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('scheduled', () => {
  it('runs a retry batch via ctx.waitUntil and logs the summary', async () => {
    mockRunRetryBatch.mockResolvedValue({ processed: 1, succeeded: 1, failed: 0 });
    const ctx = makeCtx();

    await worker.scheduled!({} as ScheduledController, ENV, ctx);
    await Promise.all(ctx.waitUntilPromises);

    expect(mockRunRetryBatch).toHaveBeenCalledWith(ENV);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"processed":1'),
    );
  });

  it('logs and swallows a batch failure instead of throwing', async () => {
    mockRunRetryBatch.mockRejectedValue(new Error('db unreachable'));
    const ctx = makeCtx();

    await worker.scheduled!({} as ScheduledController, ENV, ctx);
    await expect(Promise.all(ctx.waitUntilPromises)).resolves.toBeDefined();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('db unreachable'),
    );
  });

  it('stringifies a non-Error rejection', async () => {
    mockRunRetryBatch.mockRejectedValue('not an Error instance');
    const ctx = makeCtx();

    await worker.scheduled!({} as ScheduledController, ENV, ctx);
    await Promise.all(ctx.waitUntilPromises);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('not an Error instance'),
    );
  });
});

describe('fetch', () => {
  it('returns 404 for every request; there is no public route', async () => {
    const response = await worker.fetch!(
      new Request('https://example.com/'),
      ENV,
      makeCtx(),
    );
    expect(response.status).toBe(404);
  });

  it.each(['GET', 'POST', 'PUT', 'DELETE'])('returns 404 for %s as well', async (method) => {
    const response = await worker.fetch!(
      new Request('https://example.com/anything', { method }),
      ENV,
      makeCtx(),
    );
    expect(response.status).toBe(404);
  });
});
