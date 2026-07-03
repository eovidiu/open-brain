import crypto from 'node:crypto';
import type { MemoryMetadata } from './types.js';

// ::vector cast round-trip against a real Neon branch (F003 acceptance):
// insert an embedding array, read it back identically.
// Skipped unless NEON_TEST_DATABASE_URL is set — never point it at production.

import { createDb, insertMemory, parseVector } from './index.js';

const NEON_URL = process.env.NEON_TEST_DATABASE_URL;

const METADATA: MemoryMetadata = {
  type: 'insight',
  topics: ['vector-round-trip'],
  people: [],
  action_items: [],
  confidence: 0.7,
  truncated: false,
};

describe.skipIf(!NEON_URL)('::vector round-trip', () => {
  it('reads back an inserted embedding identically', async () => {
    const sql = createDb(NEON_URL!);
    const id = crypto.randomUUID();
    const embedding = Array.from({ length: 1536 }, (_, i) =>
      Number(Math.sin(i + 1).toFixed(6)),
    );

    try {
      await insertMemory(sql, {
        id,
        raw_text: `vector round-trip probe ${id}`,
        embedding,
        embedding_status: 'ready',
        metadata: METADATA,
        metadata_status: 'ready',
        captured_at: new Date().toISOString(),
        source: 'api',
      });

      const rows = await sql`SELECT embedding FROM memories WHERE id = ${id}`;
      expect(parseVector(rows[0].embedding)).toEqual(embedding);
    } finally {
      await sql`DELETE FROM memories WHERE id = ${id}`;
    }
  });
});
