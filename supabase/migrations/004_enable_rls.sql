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
