const { mockNeon } = vi.hoisted(() => ({ mockNeon: vi.fn() }));

vi.mock('@neondatabase/serverless', () => ({ neon: mockNeon }));

describe('getDb', () => {
  const ORIGINAL_URL = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.resetModules();
    mockNeon.mockClear();
    mockNeon.mockReturnValue(vi.fn());
  });

  afterEach(() => {
    process.env.DATABASE_URL = ORIGINAL_URL;
  });

  it('throws when DATABASE_URL is not set', async () => {
    delete process.env.DATABASE_URL;
    const { getDb } = await import('./client.js');

    expect(() => getDb()).toThrow('DATABASE_URL must be set');
  });

  it('creates a connection from DATABASE_URL', async () => {
    process.env.DATABASE_URL = 'postgres://user:pw@host/db';
    const { getDb } = await import('./client.js');

    getDb();

    expect(mockNeon).toHaveBeenCalledWith('postgres://user:pw@host/db');
  });

  it('reuses the connection on subsequent calls', async () => {
    process.env.DATABASE_URL = 'postgres://user:pw@host/db';
    const { getDb } = await import('./client.js');

    const first = getDb();
    const second = getDb();

    expect(second).toBe(first);
    expect(mockNeon).toHaveBeenCalledTimes(1);
  });
});
