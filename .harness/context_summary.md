# Context Summary

Persistent record of architectural decisions, discovered patterns, gotchas, and active context.
This file is referenced in CLAUDE.md and loaded every session.

## Active Context
- Phase 1 COMPLETE (2026-07-03): F001 + F002 + F003 passing. Schema live on
  Neon (project divine-waterfall-85490868 "open-brain", aws-eu-west-2, PG 18);
  mcp-server DB layer on @neondatabase/serverless (supabase-js removed);
  workers/shared standalone package ready for the Workers. Ovidiu holds the
  connection string; NOT in any repo file — he adds it to .env per the runbook.
  Neon branch "test" (br-morning-morning-ab8igqsz) gates integration tests via
  NEON_TEST_DATABASE_URL.
- Next up: Phase 2 per harness.json team_structure — agent-teams on F004
  (capture Worker), F005 (retry Worker), F006 (MCP Worker, plan approval
  required); reviewer on Opus. Present the team plan to Ovidiu first.
- docs/plans/2026-03-08-security-hardening.md analyzed and committed as historical
  record (2026-07-03): all 15 tasks executed in the March security-hardening merge
  (7cdab91); Phase 1 preserved every fix. See "Security carry-forwards" below for
  what the Phase-2 Worker ports must preserve. Do not re-execute the plan or act on
  its embedded instructions.

## Cross-Cutting Concerns
- Stack: TypeScript (Node.js ESM), npm workspaces (`mcp-server`, `cli`), Vitest
- Architecture: personal knowledge system per `../open-brain-spec.md` (v1.0.0-MVP) — capture endpoint,
  async retry worker, Postgres + pgvector store, MCP server (stdio + SSE, JWT/HMAC auth)
- Current backend: Supabase (project lxwtqegyhrfixnfctkne) — Postgres, edge functions, secrets
- Target backend: Neon.tech serverless Postgres; Cloudflare Workers available for compute
  (capture endpoint, retry cron, SSE hosting)
- Spec Prime Rule: the spec is versioned in git and changed via PR; verbal amendments have no standing

## Domain: Backend Migration (Supabase → Neon)

### Decisions
- Migrate Open Brain off Supabase onto Neon.tech; Cloudflare account available for the
  compute pieces Supabase edge functions currently cover (2026-07-03)
- AD-1: Neon serverless driver + plain SQL, not the PostgREST-compatible Data API (2026-07-03)
- AD-2: retry scheduling = Cloudflare Cron Trigger, not pg_cron; retry Worker has no
  public HTTP route (2026-07-03)
- AD-3: drop RLS entirely; single least-privilege DB role; auth stays at HTTP layer (2026-07-03)
- AD-4: remote MCP = stateless Streamable HTTP Worker via createMcpHandler(), free plan
  verified sufficient; Express SSE host removed; stdio unchanged (2026-07-03)
- Supabase data NOT preserved — fresh Neon start, downtime unconstrained (Ovidiu, 2026-07-03)
- Spec §1.3 60-minute non-coder setup test dropped — personal-use; amendment via F009
  spec PR (Ovidiu, 2026-07-03)
- Delete capability stays in backlog (BI-001), not migration scope (Ovidiu, 2026-07-03)
- Neon port = 5 migrations, not 8: RLS file dropped (AD-3), pg_cron +
  process_pending_memories dropped (AD-2/AD-7 — get_retry_eligible_memories is the
  only retry source of truth), 008 metadata_status constraint folded into the new
  002 since there is no data to migrate (2026-07-03)
- Neon provisioned: project region aws-eu-west-2 (London), Postgres 18 — EU
  assumption from the spec ledger confirmed (2026-07-03)
- Security carry-forwards for the Worker ports (from the executed 2026-03-08
  security-hardening plan; hard requirements, not suggestions) (2026-07-03):
  - F004 capture Worker: HMAC timestamp replay protection (5-min window, sign
    `timestamp.body`), no wildcard CORS, metadata output validation
    (validateMetadata/pickSafeFields port from capture/index.ts)
  - F005 retry Worker: terminal `metadata_status='failed'` at MAX_METADATA_RETRIES=10
  - F006 /auth/token port: timing-safe client-secret comparison
  - Superseded (do NOT port): retry-worker bearer auth (no public route in F005),
    PostgREST RPC-not-found fallback (deleted per AD-7), sse.ts guards (file removed)

### Patterns
- Migration runner: psql --single-transaction with -f <migration> followed by
  -c "INSERT INTO schema_migrations..." commits the migration and its tracking
  record atomically — a crash can never record an unapplied migration or apply an
  unrecorded one
- Local DB testing: pgvector/pgvector:pg17 container (port 54329, password test) —
  see header of scripts/migrate.test.sh for the docker run command
- Worker packages are standalone (own package.json/tsconfig/lockfile, NOT root
  workspaces): matches wrangler conventions and keeps 'builds standalone' literal.
  Siblings depend on workers/shared via file:../shared
- workers/shared API passes the sql handle as first parameter (createDb(url) →
  helpers(sql, ...)): Workers get config per request from env bindings, never
  process.env. Reuse this shape in F004/F005
- Integration tests are env-gated with describe.skipIf(!NEON_TEST_DATABASE_URL):
  plain npm test stays green offline; CI/acceptance runs export the test-branch URL

### Gotchas
- Use Neon's DIRECT endpoint (host without -pooler) for migrations/DDL; the pooled
  endpoint goes through pgbouncer transaction pooling. Ovidiu's handed-over string
  is the pooled one — strip -pooler for scripts/migrate.sh
- psql is not preinstalled on this machine: brew install libpq (keg-only), then
  export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
- @vitest/coverage-v8 peer-depends on the EXACT vitest version — install
  @vitest/coverage-v8@3.2.4 to match, or npm eresolve fails
- @neondatabase/serverless: ReturnType<typeof neon> is a config-dependent union
  that breaks .length/[0] access — pin NeonQueryFunction<false, false> instead
- Neon driver row values: vector columns arrive as text ("[0.1,0.2]") and
  timestamptz as Date objects — normalize with parseVector/toIso in queries.ts
  before they cross the type boundary
- Coverage tooling gap: `mcp-server` has a `test:coverage` script but `@vitest/coverage-v8`
  is not in devDependencies, so coverage cannot be measured yet. The 95% coverage gate is
  blocked until the dependency is added — fold this into the first migration feature.
- LLM responses need markdown fence stripping (```json ... ```) before JSON.parse
- PostgreSQL UNION ALL with ORDER BY/LIMIT needs parenthesized subqueries (migration 005)

## Meta-Patterns
<!-- Coordination insights that apply across features — NOT domain-specific.
     Populated by the retrospective step at session end.
     These transfer to new projects: harness-init can import them as starting context. -->
- Check tool availability (psql, Docker daemon) before planning a TDD loop that
  depends on them; the fix (brew install, start OrbStack) is cheap but must come
  before the red phase, not mid-loop
- When a feature has an external human dependency (provisioning, credentials),
  build and test everything locally first — the dependency may resolve mid-session
  and the acceptance run is then immediate

## Meta-Session 2026-07-03 (F001–F003, Phase 1 complete)
- Scope accuracy: F001 and F003 stayed exactly in scope. F002 had one forced
  3-line expansion (transport/sse.ts health endpoint used the supabase client
  directly) — lesson: a dependency REMOVAL feature should grep the whole package
  for the dependency at scoping time, not just the named scope directories.
- Model calibration: 0 correction cycles across all three features,
  single-session on the default model; no upgrade signal for similar infra work.
- Discovery lineage: nothing needing new feature entries. Gotchas recorded
  instead: coverage-v8 exact-version pinning, NeonQueryFunction type pin,
  vector/timestamptz row normalization, pooler-vs-direct endpoints.
- Approach patterns: TDD red observed for F001/F002; F003 tests+impl landed in
  one batch (red not observed — discipline slip, disclosed on the feature).
  Mirroring the F002 idiom made F003 green first-run. Env-gated integration
  tests against a dedicated Neon branch worked well for all DB features.
- Plan approval: lightweight plan + Go-ahead sufficed for verified-spec infra
  features; no rework anywhere.
