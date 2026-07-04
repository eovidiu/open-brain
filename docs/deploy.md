# Deployment Reference — Neon + Cloudflare Workers

The `openbrain setup` CLI automates all of this. This document is the manual
reference for what it does, for debugging or selective re-runs.

## Components

| Component | Where | Config |
|-----------|-------|--------|
| Database | Neon Postgres + pgvector | `db/migrations/` (5 files, tracked in `schema_migrations`) |
| Capture Worker | `workers/capture/` | `wrangler.toml` (name: `open-brain-capture`) |
| Retry Worker | `workers/retry/` | `wrangler.toml` (name: `open-brain-retry-worker`, cron `* * * * *`) |
| MCP Worker | `workers/mcp/` | `wrangler.toml` (name: `open-brain-mcp`, `nodejs_compat`) |
| Local MCP server | `mcp-server/` | stdio only; configured in Claude Desktop |

## Database migrations

```bash
DATABASE_URL='postgresql://...' scripts/migrate.sh
```

- Use the **direct** endpoint (no `-pooler` in the host) — the pooled endpoint
  goes through pgbouncer transaction pooling, which breaks `--single-transaction`.
- The runner is idempotent: applied migrations are recorded in
  `schema_migrations` and skipped on re-runs.

## Worker deploys

Each Worker is a standalone package (own `package.json` and lockfile):

```bash
cd workers/<name>
npm ci
npx wrangler deploy
```

## Worker secrets

Set per Worker with `npx wrangler secret put <NAME>` (run in the Worker's directory):

| Secret | capture | retry | mcp |
|--------|---------|-------|-----|
| `DATABASE_URL` | yes | yes | yes |
| `CAPTURE_JWT_SECRET` | yes | — | yes |
| `CAPTURE_WEBHOOK_SECRET` | yes | — | — |
| `MCP_CLIENT_SECRET` | — | — | yes |
| `OPENAI_API_KEY` | yes | yes | yes |
| `ANTHROPIC_API_KEY` | optional | optional | optional |
| `OPENAI_METADATA_API_KEY` | optional | optional | optional |
| `METADATA_LLM_PROVIDER` | optional | optional | optional |
| `EMBEDDING_MODEL` | — | — | optional |

## Endpoints

- **Capture**: `POST https://open-brain-capture.<subdomain>.workers.dev/`
  - Auth: `Authorization: Bearer <JWT>` (HS256, `CAPTURE_JWT_SECRET`) or HMAC
    headers `X-OpenBrain-Signature` + `X-OpenBrain-Timestamp` (signature =
    HMAC-SHA256 over `timestamp.body` with `CAPTURE_WEBHOOK_SECRET`, 5-minute
    replay window)
  - `201` with `{ id }` on success; degraded processing stores the memory with
    `embedding_status: 'pending'` rather than rejecting
- **Retry**: no public route (all HTTP returns 404); runs on the cron trigger
- **MCP**: `https://open-brain-mcp.<subdomain>.workers.dev`
  - `POST /auth/token` with `{ "client_secret": "<MCP_CLIENT_SECRET>" }` → JWT
    (1h expiry, rate-limited 5/15min per IP)
  - `GET /health` → DB connectivity + embedding model
  - All other paths: Streamable HTTP MCP, `Authorization: Bearer <JWT>` required

## Verification

```bash
npm run dev --workspace=cli status   # .env, Neon, both Worker health checks
```

Watch a deployed Worker's logs:

```bash
cd workers/<name> && npx wrangler tail
```
