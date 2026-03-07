-- Enable Row Level Security on both tables
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

-- Deny all access for anon and authenticated roles.
-- Service-role key bypasses RLS, so edge functions and backend still have access.
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
