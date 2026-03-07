-- RPC function for retry worker to find eligible records with exponential backoff
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
