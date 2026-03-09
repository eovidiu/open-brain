# Deploy to Supabase

This is the detailed reference guide. **Most users should use the automated setup instead:**

```bash
npx @eovidiu/open-brain-setup
```

See the [README](../README.md) for the 3-step quick start. This guide is for people who want to understand what's happening under the hood or deploy manually.

---

## What the automated setup does

When you run `npx @eovidiu/open-brain-setup`, it performs these steps automatically:

1. Validates your Supabase connection and API keys
2. Generates a secure MCP client secret (48-char base64url token)
3. Creates all database tables and indexes via migrations
4. Sets your API keys as Supabase Edge Function secrets
5. Deploys the `open-brain-mcp` Edge Function
6. Prints the MCP config JSON to paste into your AI client

If you need to do any of these steps manually, read on.

---

## Manual deployment

### 1. Create a Supabase project

1. Sign up at [supabase.com](https://supabase.com) (free tier works).
2. Click **New Project**. Pick a region close to you.
3. Go to **Project Settings → API** and note your:
   - **Project URL** — `https://<project-ref>.supabase.co`
   - **Service Role Key** — starts with `eyJ...`
   - **Project Ref** — the subdomain part of the URL (e.g. `xyzabc`)

### 2. Install the Supabase CLI

```bash
npm install -g supabase
```

Or with Homebrew: `brew install supabase/tap/supabase`

Then log in and link your project:

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

### 3. Run migrations

The migrations are in `supabase/migrations/`. Run them all at once with:

```bash
supabase db push
```

Or run each file manually in the Supabase SQL Editor (in order):

| File | What it does |
|------|-------------|
| `001_enable_extensions.sql` | Enables `pgvector` and `pg_cron` extensions |
| `002_create_memories.sql` | Creates the `memories` table with HNSW vector index |
| `003_create_system_config.sql` | Creates singleton config table, seeds embedding model |
| `004_enable_rls.sql` | Enables Row Level Security, blocks anon/authenticated access |
| `005_create_retry_function.sql` | Creates retry eligibility function, schedules pg_cron job |
| `006_create_rpc_functions.sql` | Creates `search_memories` and `get_memory_stats` RPC functions |
| `007_create_retry_eligible_rpc.sql` | Creates `get_retry_eligible_memories` RPC for the retry worker |
| `008_add_metadata_failed_status.sql` | Adds `failed` as a valid metadata status |

**Note about pg_cron:** On some Supabase plans, `pg_cron` must be enabled manually via **Database → Extensions** in the dashboard before running migration 005. If pg_cron is unavailable, the retry worker won't auto-run — memories with failed embeddings will stay `pending` until manually reprocessed.

### 4. Set secrets

```bash
# Required
supabase secrets set \
  OPENAI_API_KEY=sk-... \
  MCP_CLIENT_SECRET=$(openssl rand -base64 36 | tr '+/' '-_' | tr -d '=')

# Optional: for better metadata extraction
supabase secrets set \
  ANTHROPIC_API_KEY=sk-ant-... \
  METADATA_LLM_PROVIDER=anthropic

# Or use OpenAI for metadata too (no extra key needed)
supabase secrets set METADATA_LLM_PROVIDER=openai
```

### 5. Deploy the edge function

```bash
supabase functions deploy open-brain-mcp --no-verify-jwt
```

> The `--no-verify-jwt` flag is required because the function handles its own authentication via the `MCP_CLIENT_SECRET` bearer token (not Supabase JWT auth).

### 6. Verify

Test the MCP endpoint is reachable:

```bash
curl -X POST https://<your-project>.supabase.co/functions/v1/open-brain-mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_MCP_CLIENT_SECRET" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}'
```

You should get a JSON-RPC response with the server capabilities.

### 7. Configure your AI client

Add this to your MCP client config:

```json
{
  "mcpServers": {
    "open-brain": {
      "type": "http",
      "url": "https://<your-project>.supabase.co/functions/v1/open-brain-mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_CLIENT_SECRET"
      }
    }
  }
}
```

| Client | Config location |
|--------|----------------|
| Claude Desktop | Settings → Developer → Edit Config |
| Claude Code | `~/.claude.json` or `.mcp.json` in project root |
| Cursor | Settings → MCP Servers → Add |
| Windsurf | Settings → MCP → Add Server |

---

## Database schema

### `memories` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key (auto-generated) |
| `raw_text` | text | The memory content (1–10,000 chars) |
| `embedding` | vector(1536) | OpenAI embedding for semantic search |
| `embedding_status` | text | `ready`, `pending`, or `failed` |
| `metadata` | jsonb | Extracted type, topics, people, action items |
| `metadata_status` | text | `ready`, `degraded`, or `failed` |
| `captured_at` | timestamptz | When the memory was captured |
| `source` | text | `slack`, `claude`, `chatgpt`, `mcp_direct`, or `api` |

### `system_config` table

Singleton table (always `id = 1`) storing the embedding model configuration.

### RPC functions

| Function | Description |
|----------|-------------|
| `search_memories(query_embedding, match_count, filter_type, filter_since)` | Vector similarity search |
| `get_memory_stats()` | Aggregate statistics |
| `get_retry_eligible_memories(batch_limit)` | Finds memories due for retry |

---

## Security model

- **Row Level Security (RLS)** is enabled on all tables. Anonymous and authenticated roles are denied all access.
- **Service role key** bypasses RLS and is used by the Edge Function.
- **MCP client secret** is a bearer token checked by the Edge Function using constant-time comparison. It's independent of Supabase auth.
- The Edge Function runs with `--no-verify-jwt` because it implements its own auth layer.
