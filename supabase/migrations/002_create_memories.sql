-- Create the memories table
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

-- Embedding must be present iff status is 'ready'
ALTER TABLE memories ADD CONSTRAINT embedding_status_consistency
  CHECK (
    (embedding_status = 'ready'  AND embedding IS NOT NULL) OR
    (embedding_status != 'ready' AND embedding IS NULL)
  );

-- HNSW index for approximate nearest-neighbor search on embeddings
CREATE INDEX memories_embedding_hnsw_idx
  ON memories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Index for listing recent memories
CREATE INDEX memories_captured_at_desc_idx
  ON memories (captured_at DESC);

-- Index for the retry worker to find pending/failed embeddings
CREATE INDEX memories_embedding_status_idx
  ON memories (embedding_status);
