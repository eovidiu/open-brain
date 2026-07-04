import crypto from 'node:crypto';
import { createDb } from 'open-brain-workers-shared';
import { runRetryBatch } from './retry-batch.js';

// Real Neon branch, real get_retry_eligible_memories() call (F005 acceptance):
// seed a pending memory past its backoff window and confirm one scheduled
// batch carries it to embedding_status='ready'. LLM calls are stubbed —
// only the DB round trip is real. Skipped unless NEON_TEST_DATABASE_URL is
// set — never point it at production.

const NEON_URL = process.env.NEON_TEST_DATABASE_URL;

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe.skipIf(!NEON_URL)('runRetryBatch against a real Neon branch', () => {
  it('processes a seeded pending memory to completion within one run', async () => {
    const sql = createDb(NEON_URL!);
    const id = crypto.randomUUID();
    // retry_count_embedding=0 backs off 30s; captured a minute ago is eligible now.
    const capturedAt = new Date(Date.now() - 60_000).toISOString();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: Array(1536).fill(0.01) }] }),
    });

    try {
      await sql`
        INSERT INTO memories (
          id, raw_text, embedding, embedding_status, metadata, metadata_status,
          captured_at, source, retry_count_embedding, retry_count_metadata
        )
        VALUES (
          ${id}, 'F005 integration probe', NULL, 'pending', '{}'::jsonb, 'ready',
          ${capturedAt}, 'api', 0, 0
        )
      `;

      const summary = await runRetryBatch({
        DATABASE_URL: NEON_URL!,
        OPENAI_API_KEY: 'sk-test-key',
      });

      expect(summary.processed).toBeGreaterThanOrEqual(1);

      const rows = await sql`
        SELECT embedding_status, retry_count_embedding FROM memories WHERE id = ${id}
      `;
      expect(rows[0].embedding_status).toBe('ready');
    } finally {
      await sql`DELETE FROM memories WHERE id = ${id}`;
    }
  });
});
