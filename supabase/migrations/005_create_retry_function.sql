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
  -- Records needing embedding retry
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

  UNION ALL

  -- Records needing metadata retry
  SELECT
    id            AS memory_id,
    'metadata'    AS retry_type,
    retry_count_metadata AS current_retries
  FROM memories
  WHERE metadata_status = 'degraded'
    AND retry_count_metadata < 10
    AND captured_at + (interval '30 seconds' * power(2, retry_count_metadata)) <= now()
  ORDER BY captured_at ASC
  LIMIT 20;
$$;

-- Schedule the retry worker to run every minute via pg_cron
SELECT cron.schedule(
  'retry-pending-memories',
  '* * * * *',
  'SELECT process_pending_memories()'
);
