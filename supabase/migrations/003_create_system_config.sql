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
