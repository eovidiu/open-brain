# Open Brain: Supabase → Neon.tech Migration — Verified Specification

**Date**: 2026-07-03 (normalized after spec-verification ASK → 8 answers → reverification-guard PASS)
**Status**: VERIFIED — features F001–F009 recorded in `.harness/features.json` with spec hashes
**Spec impact**: amends `open-brain-spec.md` §1.3, §5, §8 via spec PR (carried by F009, per the Prime Rule)

## Problem

Open Brain MVP runs on Supabase (Postgres + pgvector, two Deno edge functions, pg_cron,
PostgREST access via supabase-js). The system must run on Neon.tech serverless Postgres,
with Cloudflare Workers (free plan) as compute: capture endpoint, retry scheduling via
Cron Trigger, and remote MCP transport (stateless Streamable HTTP). Existing Supabase data
is not preserved. The four MCP tools (`search_brain`, `list_recent`, `get_stats`,
`capture_memory`), the auth model (JWT HS256 + HMAC webhook signing), and the LLM
providers (OpenAI embeddings, Anthropic/OpenAI metadata) are unchanged.

Dependency analysis (2026-07-03, file:line inventory in session record): pgvector
`vector(1536)` + HNSW, all SQL function bodies, `mcp-server/src/auth/*`, and the
embedding/metadata services port cleanly. Rework: pg_cron → Cron Trigger; Deno edge
functions → Workers; supabase-js/PostgREST (`.rpc()`, `.from()`, `.or()`) → plain SQL over
`@neondatabase/serverless`; RLS on Supabase-injected roles → dropped (single
least-privilege DB role); Supabase CLI setup steps → psql runner + wrangler. Single
chokepoint: `mcp-server/src/db/client.ts:15`.

Architecture decisions AD-1…AD-7 (verbatim from the reviewed plan):
- **AD-1**: Neon serverless driver over Neon Data API; plain SQL everywhere.
- **AD-2**: Retry scheduling via Cloudflare Cron Trigger (`* * * * *`), not pg_cron
  (pg_cron on Neon is plan/config-dependent and needs always-on compute; Cron Trigger is
  free-plan-native, DB stays scale-to-zero). Retry Worker: `scheduled()` only, no public route.
- **AD-3**: Drop RLS — backend-only DB access, single least-privilege role; security stays
  at the HTTP layer (JWT/HMAC, unchanged).
- **AD-4**: Remote MCP transport = stateless Streamable HTTP Worker via `createMcpHandler()`
  (free plan verified sufficient 2026-07-03; SSE deprecated in the MCP spec). Express SSE
  host removed; stdio stays for local Claude Desktop.
- **AD-5**: Secrets in platform stores (Wrangler secrets; local `.env`).
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`DB_PASSWORD` → `DATABASE_URL`.
- **AD-6**: External-call failure behavior inherited, not redesigned: on embedding/metadata
  failure the memory is stored with `embedding_status` `'pending'`/`'failed'` and the retry
  worker picks it up. Existing per-provider timeouts carried over verbatim.
- **AD-7**: Retry eligibility has one source of truth: `get_retry_eligible_memories()`,
  called directly. The PostgREST `.or()` fallback is not ported.

## Acceptance criteria

1. **F001**: `scripts/` migration runner applies all migrations to an empty Neon database
   idempotently (second run is a no-op, exit 0). Resulting schema contains `memories` with
   `vector(1536)` + HNSW index, `system_config`, and the three SQL functions; no `pg_cron`,
   no RLS policies, no `anon`/`authenticated` grants. Verified by a schema assertion script
   against a Neon branch.
2. **F002**: every function in `queries.ts` executes against Neon via
   `@neondatabase/serverless`; `@supabase/supabase-js` removed from
   `mcp-server/package.json`. Existing Vitest suite green + new integration round-trip test
   against a Neon branch: `capture_memory` → `search_brain` finds it → `list_recent` lists
   it → `get_stats` counts it. Coverage measurable and ≥95% on touched code.
3. **F003**: shared module builds standalone; unit tests cover connection creation, query
   helpers, and `::vector` cast round-trip (insert an embedding array, read it back
   identically).
4. **F004**: deployed capture Worker returns 201 with a memory id for a validly signed
   request (JWT and HMAC paths both tested), 401 for invalid/missing auth, 400 for invalid
   payload; on forced embedding failure the row lands with `embedding_status='pending'`.
5. **F005**: Cron-triggered run processes a seeded pending memory to `complete` within one
   scheduled invocation; the Worker has no public fetch route (HTTP returns 404/405); a
   second overlapping run does not double-process (status transitions + batch limit).
6. **F006**: an MCP client connects over Streamable HTTP to the Worker URL with a JWT from
   `/auth/token` and successfully invokes all four tools; unauthenticated connection is
   rejected.
7. **F007**: CLI setup completes end-to-end with a Neon connection string and authenticated
   wrangler: writes `.env`, runs migrations, deploys the three Workers, sets secrets;
   `status` reports all components healthy without supabase-js.
8. **F008**: runbook executed: Claude Desktop stdio works against Neon; capture Worker
   reachable on the custom domain; retry cron observed processing; Supabase project
   decommissioned only after all other criteria are observed green (rollback bound).
   Downtime unconstrained.
9. **F009**: spec PR merged (or approved by Ovidiu) amending §1.3/§5/§8; `.env.example`
   contains `DATABASE_URL` and `OPENAI_METADATA_API_KEY`, no `SUPABASE_*` vars; README
   quickstart matches the new stack.

## Edge and error cases

- Embedding/metadata provider failure during capture → row stored with `embedding_status`
  `'pending'`/`'failed'`; retry worker recovers (AD-6; asserted by criteria 4 and 5).
- Cron overlap or missed minute → status transitions + batch limit prevent
  double-processing; a missed tick self-heals on the next one (criterion 5).
- Invalid/missing auth on capture → 401; invalid payload → 400 (criterion 4).
- Unauthenticated MCP connection → rejected (criterion 6).
- Neon driver connection failure → inherited DB-error handling unchanged, including
  redaction of internal DB error details from client-facing messages (existing behavior).
- Embedding format corruption risk (supabase-js inserted JSON strings) → explicit
  `::vector` casts, asserted by the F003 round-trip test and F002 integration test.
- Migration runner re-run → idempotent no-op (criterion 1).

## Non-functional requirements

- Cloudflare free-plan limits respected: 100k requests/day, 10ms CPU per invocation (I/O
  wait excluded), per-minute cron = 1,440 requests/day, 50 external subrequests per
  invocation (verified against Cloudflare docs 2026-07-03).
- Security: JWT HS256 + HMAC preserved verbatim; least-privilege DB role; secrets in
  Wrangler secret store / local `.env`; nothing committed.
- Coverage ≥95% on touched code, measurable via `@vitest/coverage-v8` (added in F002).
- No new performance budget; existing per-provider timeouts carried over verbatim (AD-6).
- Personal-use scope: the §1.3 60-minute non-coder setup test is dropped (spec amendment
  in F009). In-memory rate limiters reset per Workers isolate — accepted at this scale.

## Dependencies

- Internal: F001 → none; F002, F003 → F001; F004, F005 → F003; F006 → F002 + F003;
  F007 → F002 + F004 + F005; F008 → F001–F006; F009 → F001–F008.
- External: Neon project (provisioned by Ovidiu following the F001 runbook; connection
  string handed over), Cloudflare account (free plan), wrangler CLI, OpenAI + Anthropic
  API keys, a DNS zone on Cloudflare for the capture Worker's custom domain.

## Assumptions ledger

- 2026-07-03 — Supabase production data is NOT preserved; fresh start on Neon (Ovidiu).
- 2026-07-03 — Cutover downtime unconstrained (Ovidiu).
- 2026-07-03 — Ovidiu provisions the Neon project himself following the F001 runbook and
  hands over the connection string. Region: EU assumed (matches current Supabase EU-West);
  confirm at provisioning time.
- 2026-07-03 — Capture Worker gets a custom domain; requires Ovidiu's domain DNS zone on
  Cloudflare (full-setup nameservers). Exact domain chosen at F004/F008 time; workers.dev
  URL is the interim fallback.
- 2026-07-03 — The §1.3 60-minute non-coder setup test is dropped; the system is
  personal-use. CLI (F007) targets Ovidiu's workflow only (spec amendment in F009).
- 2026-07-03 — Remote transport = stateless Streamable HTTP Worker (free plan verified: no
  Durable Objects needed for stateless `createMcpHandler()`).
- 2026-07-03 — No delete capability in this migration; BI-001 stays in backlog.
- 2026-07-03 — In-memory rate limiters reset per Workers isolate — accepted at personal
  scale; revisit only if abuse observed.
- 2026-07-03 — Existing per-provider timeout/degradation behavior in the edge functions is
  carried over verbatim (AD-6); no new performance budget introduced.

## Out of scope

- No new MCP tools (no delete — BI-001 stays in backlog); no schema changes beyond
  removing Supabase-specific constructs.
- No changes to auth semantics, embedding model, or metadata extraction.
- No data migration from Supabase (explicitly waived).
- Backlog items BI-001…BI-008 remain out of scope.
