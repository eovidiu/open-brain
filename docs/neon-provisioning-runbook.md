# Neon Provisioning Runbook

Provisions the Neon.tech Postgres database for open-brain and applies the schema.
Run by Ovidiu; the connection string it produces feeds F002+ (see
`docs/plans/2026-07-03-neon-migration.md`).

## 1. Create the Neon project

In the [Neon console](https://console.neon.tech) (or via the Neon MCP in a Claude
session):

- **Project name**: `open-brain`
- **Postgres version**: 17 or newer (provisioned 2026-07-03: Postgres 18)
- **Region**: EU (provisioned 2026-07-03: `aws-eu-west-2`, London)
- Plan: free tier is sufficient (scale-to-zero is expected; retry scheduling runs
  on Cloudflare Cron, not in the database)

No extra roles or databases are needed. The default role is the single
least-privilege application role (AD-3: all access is backend-only; security
lives at the HTTP layer).

## 2. Get the connection string

From the project dashboard, copy the **direct (unpooled)** connection string —
the host **without** the `-pooler` suffix. Migrations run DDL in single
transactions; use the direct endpoint. The pooled string can be used by the
application later.

Format: `postgres://<role>:<password>@<endpoint>.eu-west-2.aws.neon.tech/neondb?sslmode=require`

## 3. Install the Postgres client (once per machine)

```bash
brew install libpq
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"   # add to ~/.zshrc to persist
```

## 4. Apply migrations

```bash
DATABASE_URL='<direct connection string>' scripts/migrate.sh
```

Expected output: `applying 001_...` through `005_...`, then
`migrations: 5 applied, 0 already applied`.

Re-run the same command to confirm idempotency — expected:
`migrations: 0 applied, 5 already applied`, exit 0.

## 5. Assert the schema

```bash
DATABASE_URL='<direct connection string>' scripts/assert-schema.sh
```

Expected: all checks `ok`, final line `schema OK`, exit 0. This verifies the
`memories` table (`vector(1536)` + HNSW), `system_config` (seeded), the three
SQL functions, and the absence of pg_cron, RLS, and anon/authenticated grants.

## 6. Hand over the connection string

Put the string in the local `.env` as `DATABASE_URL` (per `.env.example`).
Never commit it. Wrangler secret stores get it later, at Worker deploy time
(F004–F006).

## Rollback

Nothing on Supabase is touched by this runbook. To start over, delete the Neon
project (or reset the branch from parent) and re-run from step 1 — the runner
rebuilds the schema from scratch on an empty database.
