-- Long-lived per-client API keys for the MCP Worker. Clients hold the raw key
-- in a static config file; only its SHA-256 hash is stored here, so a database
-- read never yields a usable credential.
CREATE TABLE api_keys (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  label        text        NOT NULL UNIQUE,
  key_hash     text        NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,

  CONSTRAINT label_length
    CHECK (char_length(label) >= 1 AND char_length(label) <= 100),

  -- SHA-256 rendered as lowercase hex is always 64 characters. Lowercase only:
  -- hashApiKey emits lowercase, so an uppercase hash could never be matched by
  -- the lookup and must not be storable.
  CONSTRAINT key_hash_format
    CHECK (key_hash ~ '^[0-9a-f]{64}$')
);

-- Every authenticated request looks the presented key up by hash. No separate
-- index is declared for it: UNIQUE (key_hash) already creates the btree the
-- planner uses for that equality lookup, and a second one on the same column
-- would only add write cost.
