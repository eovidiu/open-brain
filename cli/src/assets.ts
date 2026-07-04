// Embedded assets for npx support (no clone needed).
// These are the SQL migrations and edge function code that get scaffolded
// into a temp directory before deploying via the Supabase CLI.

export const MIGRATIONS: Record<string, string> = {

  '001_enable_extensions.sql': `\
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_cron;
`,

  '002_create_memories.sql': `\
-- Create the memories table
CREATE TABLE IF NOT EXISTS memories (
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

-- Embedding must be present iff status is 'ready'
ALTER TABLE memories DROP CONSTRAINT IF EXISTS embedding_status_consistency;
ALTER TABLE memories ADD CONSTRAINT embedding_status_consistency
  CHECK (
    (embedding_status = 'ready'  AND embedding IS NOT NULL) OR
    (embedding_status != 'ready' AND embedding IS NULL)
  );

-- HNSW index for approximate nearest-neighbor search on embeddings
CREATE INDEX IF NOT EXISTS memories_embedding_hnsw_idx
  ON memories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Index for listing recent memories
CREATE INDEX IF NOT EXISTS memories_captured_at_desc_idx
  ON memories (captured_at DESC);

-- Index for the retry worker to find pending/failed embeddings
CREATE INDEX IF NOT EXISTS memories_embedding_status_idx
  ON memories (embedding_status);
`,

  '003_create_system_config.sql': `\
-- Singleton configuration table (exactly one row, id = 1)
CREATE TABLE IF NOT EXISTS system_config (
  id                   int         PRIMARY KEY,
  embedding_model      text        NOT NULL,
  embedding_dimensions int         NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT singleton CHECK (id = 1)
);

-- Seed the initial configuration
INSERT INTO system_config (id, embedding_model, embedding_dimensions)
VALUES (1, 'text-embedding-3-small', 1536)
ON CONFLICT (id) DO NOTHING;
`,

  '004_enable_rls.sql': `\
-- Enable Row Level Security on both tables.
-- ACCESS MODEL: All data access is through the service role key (which bypasses
-- RLS). The deny-all policies below block anon and authenticated roles as a
-- defense-in-depth measure. If user-facing access is ever needed, add explicit
-- GRANT policies for the target role — do not remove these deny policies.
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

-- Deny all access for anon and authenticated roles.
-- Service-role key bypasses RLS, so edge functions and backend still have access.
DO $$ BEGIN
  CREATE POLICY "deny_anon_memories"
    ON memories FOR ALL TO anon
    USING (false) WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "deny_authenticated_memories"
    ON memories FOR ALL TO authenticated
    USING (false) WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "deny_anon_config"
    ON system_config FOR ALL TO anon
    USING (false) WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "deny_authenticated_config"
    ON system_config FOR ALL TO authenticated
    USING (false) WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
`,

  '005_create_retry_function.sql': `\
-- Function that identifies memories eligible for embedding or metadata retry.
-- Actual API calls are handled by the edge function; this just returns eligible records.
CREATE OR REPLACE FUNCTION process_pending_memories()
RETURNS TABLE (
  memory_id        uuid,
  retry_type       text,
  current_retries  int
)
LANGUAGE sql
STABLE
AS $$
  (
    SELECT
      id            AS memory_id,
      'embedding'   AS retry_type,
      retry_count_embedding AS current_retries
    FROM memories
    WHERE embedding_status = 'pending'
      AND retry_count_embedding < 10
      AND captured_at + (interval '30 seconds' * power(2, retry_count_embedding)) <= now()
    ORDER BY captured_at ASC
    LIMIT 20
  )
  UNION ALL
  (
    SELECT
      id            AS memory_id,
      'metadata'    AS retry_type,
      retry_count_metadata AS current_retries
    FROM memories
    WHERE metadata_status = 'degraded'
      AND retry_count_metadata < 10
      AND captured_at + (interval '30 seconds' * power(2, retry_count_metadata)) <= now()
    ORDER BY captured_at ASC
    LIMIT 20
  );
$$;

-- Schedule the retry worker to run every minute via pg_cron (idempotent: unschedule first if exists)
DO $$ BEGIN
  PERFORM cron.unschedule('retry-pending-memories');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

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

  '009_fix_search_path_and_cleanup.sql': `\
-- Fix C1: Add SET search_path to all functions to prevent search path injection.
-- Fix H1+H2: Drop the no-op cron job and redundant process_pending_memories function.
-- Fix H4: Add index on metadata_status for retry queries.

-- C1: Recreate search_memories with search_path
CREATE OR REPLACE FUNCTION search_memories(
  query_embedding vector(1536),
  match_count int DEFAULT 10,
  filter_type text DEFAULT NULL,
  filter_since timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  raw_text text,
  captured_at timestamptz,
  source text,
  metadata jsonb,
  metadata_status text,
  embedding_status text,
  similarity_score double precision
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    m.id,
    m.raw_text,
    m.captured_at,
    m.source,
    m.metadata,
    m.metadata_status,
    m.embedding_status,
    1 - (m.embedding <=> query_embedding) AS similarity_score
  FROM memories m
  WHERE m.embedding_status = 'ready'
    AND (filter_type IS NULL OR m.metadata->>'type' = filter_type)
    AND (filter_since IS NULL OR m.captured_at >= filter_since)
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- C1: Recreate get_memory_stats with search_path
CREATE OR REPLACE FUNCTION get_memory_stats()
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH
    counts AS (
      SELECT
        COUNT(*) AS total_memories,
        COUNT(*) FILTER (WHERE captured_at >= now() - interval '7 days') AS last_7_days,
        COUNT(*) FILTER (WHERE captured_at >= now() - interval '30 days') AS last_30_days
      FROM memories
    ),
    type_counts AS (
      SELECT
        COALESCE(metadata->>'type', 'unknown') AS memory_type,
        COUNT(*) AS cnt
      FROM memories
      GROUP BY COALESCE(metadata->>'type', 'unknown')
    ),
    status_counts AS (
      SELECT
        embedding_status,
        COUNT(*) AS cnt
      FROM memories
      GROUP BY embedding_status
    ),
    topic_counts AS (
      SELECT
        topic::text AS topic,
        COUNT(*) AS cnt
      FROM memories, jsonb_array_elements_text(metadata->'topics') AS topic
      GROUP BY topic::text
      ORDER BY COUNT(*) DESC
      LIMIT 10
    ),
    config AS (
      SELECT embedding_model FROM system_config WHERE id = 1
    )
  SELECT json_build_object(
    'total_memories', (SELECT total_memories FROM counts),
    'last_7_days', (SELECT last_7_days FROM counts),
    'last_30_days', (SELECT last_30_days FROM counts),
    'by_type', COALESCE(
      (SELECT json_object_agg(memory_type, cnt) FROM type_counts),
      '{}'::json
    ),
    'by_embedding_status', COALESCE(
      (SELECT json_object_agg(embedding_status, cnt) FROM status_counts),
      '{}'::json
    ),
    'embedding_model', (SELECT embedding_model FROM config),
    'top_topics', COALESCE(
      (SELECT json_agg(json_build_object('topic', topic, 'count', cnt)) FROM topic_counts),
      '[]'::json
    )
  );
$$;

-- C1: Recreate get_retry_eligible_memories with search_path
CREATE OR REPLACE FUNCTION get_retry_eligible_memories(batch_limit int DEFAULT 20)
RETURNS TABLE (
  id uuid,
  embedding_status text,
  metadata_status text,
  retry_count_embedding int,
  retry_count_metadata int,
  captured_at timestamptz,
  raw_text text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    m.id,
    m.embedding_status,
    m.metadata_status,
    m.retry_count_embedding,
    m.retry_count_metadata,
    m.captured_at,
    m.raw_text
  FROM memories m
  WHERE
    (
      m.embedding_status = 'pending'
      AND m.retry_count_embedding < 10
      AND now() >= m.captured_at + (interval '30 seconds' * power(2, m.retry_count_embedding))
    )
    OR
    (
      m.metadata_status = 'degraded'
      AND m.retry_count_metadata < 10
      AND now() >= m.captured_at + (interval '30 seconds' * power(2, m.retry_count_metadata))
    )
  ORDER BY m.captured_at ASC
  LIMIT batch_limit;
$$;

-- H1: Remove the no-op cron job (guarded in case pg_cron is unavailable or job doesn't exist)
DO $$ BEGIN
  PERFORM cron.unschedule('retry-pending-memories');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron.unschedule skipped: %', SQLERRM;
END $$;

-- H2: Drop the redundant process_pending_memories function
DROP FUNCTION IF EXISTS process_pending_memories();

-- H4: Add composite partial index for retry queries on metadata_status
CREATE INDEX IF NOT EXISTS memories_retry_eligible_idx
  ON memories (captured_at ASC)
  WHERE embedding_status = 'pending' OR metadata_status = 'degraded';
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
