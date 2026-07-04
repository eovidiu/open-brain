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
