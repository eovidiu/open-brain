import crypto from 'node:crypto';
import type { MemoryMetadata } from '../types.js';

// Integration round-trip against a real Neon branch (F002 acceptance).
// LLM providers are stubbed; the database is the boundary under test.
// Skipped unless NEON_TEST_DATABASE_URL is set — never point it at production.

vi.mock('../services/embedding.js', () => ({ generateEmbedding: vi.fn() }));
vi.mock('../services/metadata.js', () => ({ extractMetadata: vi.fn() }));

import { captureMemory } from '../services/capture.js';
import { handleSearchBrain } from '../tools/search-brain.js';
import { handleListRecent } from '../tools/list-recent.js';
import { getStats } from './queries.js';
import { getDb } from './client.js';
import { generateEmbedding } from '../services/embedding.js';
import { extractMetadata } from '../services/metadata.js';

const NEON_URL = process.env.NEON_TEST_DATABASE_URL;

const VECTOR = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));

const METADATA: MemoryMetadata = {
  type: 'insight',
  topics: ['round-trip'],
  people: [],
  action_items: [],
  confidence: 0.9,
  truncated: false,
};

describe.skipIf(!NEON_URL)('Neon round-trip', () => {
  const capturedIds: string[] = [];

  beforeAll(() => {
    process.env.DATABASE_URL = NEON_URL;
    vi.mocked(generateEmbedding).mockResolvedValue(VECTOR);
    vi.mocked(extractMetadata).mockResolvedValue({
      metadata: METADATA,
      status: 'ready',
    });
  });

  afterAll(async () => {
    if (capturedIds.length > 0) {
      const sql = getDb();
      await sql`DELETE FROM memories WHERE id = ANY(${capturedIds}::uuid[])`;
    }
  });

  it('capture -> search finds it -> list_recent lists it -> stats counts it', async () => {
    const text = `round-trip probe ${crypto.randomUUID()}`;

    const captured = await captureMemory(text, 'api');
    capturedIds.push(captured.id);
    expect(captured.embedding_status).toBe('ready');
    expect(captured.metadata_status).toBe('ready');

    const found = await handleSearchBrain({ query: text });
    const hit = found.find((r) => r.id === captured.id);
    expect(hit).toBeDefined();
    expect(hit!.raw_text).toBe(text);
    expect(hit!.similarity_score).toBeGreaterThan(0.99);

    const recent = await handleListRecent({ n: 10 });
    expect(recent.map((m) => m.id)).toContain(captured.id);

    const stats = await getStats();
    expect(stats.total_memories).toBeGreaterThanOrEqual(1);
    expect(stats.embedding_model).toBe('text-embedding-3-small');
  });

  it('stores a pending row when embedding fails (AD-6 degradation)', async () => {
    vi.mocked(generateEmbedding).mockRejectedValueOnce(new Error('OpenAI down'));

    const text = `round-trip degraded ${crypto.randomUUID()}`;
    const captured = await captureMemory(text, 'api');
    capturedIds.push(captured.id);

    expect(captured.embedding_status).toBe('pending');

    const sql = getDb();
    const rows = await sql`
      SELECT embedding, embedding_status FROM memories WHERE id = ${captured.id}
    `;
    expect(rows[0].embedding).toBeNull();
    expect(rows[0].embedding_status).toBe('pending');
  });
});
