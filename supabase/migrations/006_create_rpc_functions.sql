-- RPC function for vector similarity search
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

-- RPC function for aggregate stats
CREATE OR REPLACE FUNCTION get_memory_stats()
RETURNS json
LANGUAGE sql
STABLE
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
