# Deploy to Supabase

Step-by-step guide to set up the Open Brain backend on Supabase.

## 1. Create a Supabase Project

1. Sign up at [supabase.com](https://supabase.com) (free tier works).
2. Create a new project. Pick a region close to you.
3. Note your **Project URL** and **Service Role Key** from Settings > API.

## 2. Enable Extensions

Open the SQL Editor in your Supabase dashboard and run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

**pg_cron**: Required for the retry worker. On free-tier projects, you may need to enable it manually:

1. Go to **Database > Extensions** in the Supabase dashboard.
2. Search for `pg_cron` and enable it.
3. Then run in SQL Editor:
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_cron;
   ```

If pg_cron is unavailable on your plan, the retry worker will not run automatically. Memories with failed embeddings will stay in `pending` status until manually reprocessed.

## 3. Run Migrations

Execute each migration file in order via the SQL Editor. The files are in `supabase/migrations/`:

| File | What it does |
|------|-------------|
| `001_enable_extensions.sql` | Enables pgvector and pg_cron |
| `002_create_memories.sql` | Creates the `memories` table with HNSW index |
| `003_create_system_config.sql` | Creates singleton config table, seeds embedding model |
| `004_enable_rls.sql` | Enables Row Level Security, denies anon/authenticated access |
| `005_create_retry_function.sql` | Creates retry eligibility function, schedules pg_cron job |
| `006_create_rpc_functions.sql` | Creates `search_memories` and `get_memory_stats` RPC functions |
| `007_create_retry_eligible_rpc.sql` | Creates `get_retry_eligible_memories` RPC for the retry worker |

Alternatively, if you have the Supabase CLI linked to your project:

```bash
supabase db push
```

## 4. Deploy Edge Functions

Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and link your project:

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

Deploy the functions:

```bash
supabase functions deploy capture
supabase functions deploy retry-worker
```

## 5. Configure Secrets

Set the required secrets for your Edge Functions:

```bash
supabase secrets set \
  OPENAI_API_KEY=sk-... \
  CAPTURE_JWT_SECRET=$(openssl rand -hex 32) \
  CAPTURE_WEBHOOK_SECRET=$(openssl rand -hex 32)
```

For Anthropic metadata extraction (recommended):

```bash
supabase secrets set \
  ANTHROPIC_API_KEY=sk-ant-... \
  METADATA_LLM_PROVIDER=anthropic
```

Or use OpenAI for metadata too:

```bash
supabase secrets set METADATA_LLM_PROVIDER=openai
```

## 6. Verify

Test the capture endpoint:

```bash
# Generate a JWT for testing (requires node and jsonwebtoken)
TOKEN=$(node -e "console.log(require('jsonwebtoken').sign({sub:'open-brain-owner'}, process.env.CAPTURE_JWT_SECRET, {expiresIn:'1h'}))")

curl -X POST https://<your-project>.supabase.co/functions/v1/capture \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"text": "Test memory from setup", "source": "api"}'
```

You should get a 200 response with the memory ID. Check the `memories` table in the Supabase dashboard to confirm the row was created.
