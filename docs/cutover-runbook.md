# Cutover Runbook — Supabase → Neon + Cloudflare (F008)

Executed 2026-07-04. This is the record of the cutover, kept for rollback
reference until the Supabase project is deleted permanently.

## Pre-conditions (all verified before cutover)

- Neon project `divine-waterfall-85490868` (aws-eu-west-2, PG 18), branch
  `production`, 5 migrations applied, pgvector live
- Three Workers deployed and green on live acceptance:
  - `https://open-brain-capture.eovidiu.workers.dev`
  - `https://open-brain-retry-worker.eovidiu.workers.dev` (cron `* * * * *`, no public route)
  - `https://open-brain-mcp.eovidiu.workers.dev`
- Fresh Neon data: Supabase data intentionally NOT migrated (2026-07-03 decision)

## Steps executed

1. **Workers deployed + secrets set** via wrangler (see docs/deploy.md for the
   secret matrix). `METADATA_LLM_PROVIDER=openai` everywhere — the Anthropic
   account had no API credits at cutover time; switch back per Worker after
   funding it.
2. **Live acceptance observed**:
   - Capture: 201 on JWT path and HMAC path (`sha256=` prefixed signature over
     `timestamp.body`); 401 on missing auth and stale timestamp; 400 on invalid
     payload; embedding + metadata both `ready` on real captures
   - MCP Worker: `/health` 200; `/auth/token` 401 on wrong secret, JWT issued on
     correct secret; unauthenticated MCP POST → 401; initialize handshake,
     `tools/list` (4 tools), and live `tools/call` on all four tools verified
     over Streamable HTTP
   - Retry: seeded `embedding_status='pending'` row observed repaired by the
     cron Worker (see F008 acceptance evidence in .harness/claude-progress.txt)
3. **Claude Desktop reconfigured**: `open-brain` stdio entry now runs
   `mcp-server/dist/index.js --stdio` with `DATABASE_URL` (Neon pooled),
   OpenAI/Anthropic keys, `EMBEDDING_MODEL`, `METADATA_LLM_PROVIDER=openai`.
   Verified with a real stdio MCP handshake (initialize, tools/list,
   get_stats against Neon).
4. **Webhook callers**: point external callers (Slack hooks, shortcuts, etc.)
   at `https://open-brain-capture.eovidiu.workers.dev` — same auth contract as
   the old edge function, signature header now requires the `sha256=` prefix.
   A custom domain can replace the workers.dev URL later without any code
   change (add a route in the Cloudflare dashboard).
5. **Supabase decommissioned**: project `lxwtqegyhrfixnfctkne` — executed only
   after steps 1–4 were observed green (rollback bound). This also retires the
   live wildcard-CORS regression in the old capture edge function.

## Rollback (only valid until the Supabase project is permanently deleted)

Restore the Supabase project from the dashboard, revert the Claude Desktop
`open-brain` entry to the previous supabase config, and point webhook callers
back at `https://lxwtqegyhrfixnfctkne.supabase.co/functions/v1/capture`.
Data captured on Neon after cutover does not exist in Supabase.
