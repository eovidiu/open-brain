-- Enable pgvector for embedding storage and similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable pg_cron for scheduled background jobs (if available)
-- pg_cron must be enabled via the Supabase dashboard on hosted instances
CREATE EXTENSION IF NOT EXISTS pg_cron;
