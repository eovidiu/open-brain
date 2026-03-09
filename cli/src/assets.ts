// Embedded assets for npx support (no clone needed).
// These are the SQL migrations and edge function code that get scaffolded
// into a temp directory before deploying via the Supabase CLI.

export const MIGRATIONS: Record<string, string> = {

  '001_enable_extensions.sql': `\
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_cron;
`,

  '002_create_memories.sql': `\
CREATE TABLE memories (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text              text        NOT NULL,
  embedding             vector(1536),
  embedding_status      text        NOT NULL DEFAULT 'pending',
  metadata              jsonb       NOT NULL DEFAULT '{}',
  metadata_status       text        NOT NULL DEFAULT 'degraded',
  captured_at           timestamptz NOT NULL DEFAULT now(),
  source                text        NOT NULL DEFAULT 'api',
  retry_count_embedding int         NOT NULL DEFAULT 0,
  retry_count_metadata  int         NOT NULL DEFAULT 0,
  last_processing_error text,

  CONSTRAINT raw_text_length
    CHECK (char_length(raw_text) >= 1 AND char_length(raw_text) <= 10000),
  CONSTRAINT embedding_status_valid
    CHECK (embedding_status IN ('ready', 'pending', 'failed')),
  CONSTRAINT metadata_status_valid
    CHECK (metadata_status IN ('ready', 'degraded')),
  CONSTRAINT source_valid
    CHECK (source IN ('slack', 'claude', 'chatgpt', 'mcp_direct', 'api'))
);

ALTER TABLE memories ADD CONSTRAINT embedding_status_consistency
  CHECK (
    (embedding_status = 'ready'  AND embedding IS NOT NULL) OR
    (embedding_status != 'ready' AND embedding IS NULL)
  );

CREATE INDEX memories_embedding_hnsw_idx
  ON memories USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX memories_captured_at_desc_idx
  ON memories (captured_at DESC);

CREATE INDEX memories_embedding_status_idx
  ON memories (embedding_status);
`,

  '003_create_system_config.sql': `\
CREATE TABLE system_config (
  id                   int         PRIMARY KEY,
  embedding_model      text        NOT NULL,
  embedding_dimensions int         NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT singleton CHECK (id = 1)
);

INSERT INTO system_config (id, embedding_model, embedding_dimensions)
VALUES (1, 'text-embedding-3-small', 1536);
`,

  '004_enable_rls.sql': `\
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_anon_memories"
  ON memories FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_authenticated_memories"
  ON memories FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_anon_config"
  ON system_config FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_authenticated_config"
  ON system_config FOR ALL TO authenticated
  USING (false) WITH CHECK (false);
`,

  '005_create_retry_function.sql': `\
CREATE OR REPLACE FUNCTION process_pending_memories()
RETURNS TABLE (
  memory_id        uuid,
  retry_type       text,
  current_retries  int
)
LANGUAGE sql STABLE AS $$
  (
    SELECT id AS memory_id, 'embedding' AS retry_type, retry_count_embedding AS current_retries
    FROM memories
    WHERE embedding_status = 'pending'
      AND retry_count_embedding < 10
      AND captured_at + (interval '30 seconds' * power(2, retry_count_embedding)) <= now()
    ORDER BY captured_at ASC LIMIT 20
  )
  UNION ALL
  (
    SELECT id AS memory_id, 'metadata' AS retry_type, retry_count_metadata AS current_retries
    FROM memories
    WHERE metadata_status = 'degraded'
      AND retry_count_metadata < 10
      AND captured_at + (interval '30 seconds' * power(2, retry_count_metadata)) <= now()
    ORDER BY captured_at ASC LIMIT 20
  );
$$;

SELECT cron.schedule(
  'retry-pending-memories',
  '* * * * *',
  'SELECT process_pending_memories()'
);
`,

  '006_create_rpc_functions.sql': `\
CREATE OR REPLACE FUNCTION search_memories(
  query_embedding vector(1536),
  match_count int DEFAULT 10,
  filter_type text DEFAULT NULL,
  filter_since timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id uuid, raw_text text, captured_at timestamptz, source text,
  metadata jsonb, metadata_status text, embedding_status text,
  similarity_score double precision
)
LANGUAGE sql STABLE AS $$
  SELECT
    m.id, m.raw_text, m.captured_at, m.source,
    m.metadata, m.metadata_status, m.embedding_status,
    1 - (m.embedding <=> query_embedding) AS similarity_score
  FROM memories m
  WHERE m.embedding_status = 'ready'
    AND (filter_type IS NULL OR m.metadata->>'type' = filter_type)
    AND (filter_since IS NULL OR m.captured_at >= filter_since)
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION get_memory_stats()
RETURNS json LANGUAGE sql STABLE AS $$
  WITH
    counts AS (
      SELECT
        COUNT(*) AS total_memories,
        COUNT(*) FILTER (WHERE captured_at >= now() - interval '7 days') AS last_7_days,
        COUNT(*) FILTER (WHERE captured_at >= now() - interval '30 days') AS last_30_days
      FROM memories
    ),
    type_counts AS (
      SELECT COALESCE(metadata->>'type', 'unknown') AS memory_type, COUNT(*) AS cnt
      FROM memories GROUP BY COALESCE(metadata->>'type', 'unknown')
    ),
    status_counts AS (
      SELECT embedding_status, COUNT(*) AS cnt
      FROM memories GROUP BY embedding_status
    ),
    topic_counts AS (
      SELECT topic::text AS topic, COUNT(*) AS cnt
      FROM memories, jsonb_array_elements_text(metadata->'topics') AS topic
      GROUP BY topic::text ORDER BY COUNT(*) DESC LIMIT 10
    ),
    config AS (
      SELECT embedding_model FROM system_config WHERE id = 1
    )
  SELECT json_build_object(
    'total_memories', (SELECT total_memories FROM counts),
    'last_7_days', (SELECT last_7_days FROM counts),
    'last_30_days', (SELECT last_30_days FROM counts),
    'by_type', COALESCE((SELECT json_object_agg(memory_type, cnt) FROM type_counts), '{}'::json),
    'by_embedding_status', COALESCE((SELECT json_object_agg(embedding_status, cnt) FROM status_counts), '{}'::json),
    'embedding_model', (SELECT embedding_model FROM config),
    'top_topics', COALESCE((SELECT json_agg(json_build_object('topic', topic, 'count', cnt)) FROM topic_counts), '[]'::json)
  );
$$;
`,

  '007_create_retry_eligible_rpc.sql': `\
CREATE OR REPLACE FUNCTION get_retry_eligible_memories(batch_limit int DEFAULT 20)
RETURNS TABLE (
  id uuid, embedding_status text, metadata_status text,
  retry_count_embedding int, retry_count_metadata int,
  captured_at timestamptz, raw_text text
)
LANGUAGE sql STABLE AS $$
  SELECT m.id, m.embedding_status, m.metadata_status,
    m.retry_count_embedding, m.retry_count_metadata, m.captured_at, m.raw_text
  FROM memories m
  WHERE
    (m.embedding_status = 'pending' AND m.retry_count_embedding < 10
     AND now() >= m.captured_at + (interval '30 seconds' * power(2, m.retry_count_embedding)))
    OR
    (m.metadata_status = 'degraded' AND m.retry_count_metadata < 10
     AND now() >= m.captured_at + (interval '30 seconds' * power(2, m.retry_count_metadata)))
  ORDER BY m.captured_at ASC LIMIT batch_limit;
$$;
`,

  '008_add_metadata_failed_status.sql': `\
ALTER TABLE memories DROP CONSTRAINT IF EXISTS metadata_status_valid;
ALTER TABLE memories ADD CONSTRAINT metadata_status_valid
  CHECK (metadata_status IN ('ready', 'degraded', 'failed'));
`,
};

// The edge function code is read from the repo at build time via the
// build-assets script, or falls back to reading from the file system.
// For npx distribution, this gets replaced with the actual code.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let _edgeFunctionCode: string | null = null;

function findEdgeFunctionCode(): string {
  if (_edgeFunctionCode) return _edgeFunctionCode;

  // Try reading from repo (development mode)
  const possiblePaths = [
    // Running from cli/src or cli/dist
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../supabase/functions/open-brain-mcp/index.ts'),
    // Running from repo root
    path.resolve(process.cwd(), 'supabase/functions/open-brain-mcp/index.ts'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      _edgeFunctionCode = fs.readFileSync(p, 'utf-8');
      return _edgeFunctionCode;
    }
  }

  // Fallback: try bundled asset in dist/
  const bundledPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'edge-function.ts');
  if (fs.existsSync(bundledPath)) {
    _edgeFunctionCode = fs.readFileSync(bundledPath, 'utf-8');
    return _edgeFunctionCode;
  }

  throw new Error(
    'Could not find edge function code. Expected at supabase/functions/open-brain-mcp/index.ts',
  );
}

export const EDGE_FUNCTION_CODE: string = (() => {
  // Lazy but evaluated on import — fine for CLI usage
  return findEdgeFunctionCode();
})();
