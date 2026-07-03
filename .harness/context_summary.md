# Context Summary

Persistent record of architectural decisions, discovered patterns, gotchas, and active context.
This file is referenced in CLAUDE.md and loaded every session.

## Active Context
- Migration spec VERIFIED (issue-prep: SV ASK → 8 answers → RV PASS, 2026-07-03);
  features F001–F009 in features.json with spec hashes; full spec in
  docs/plans/2026-07-03-neon-migration.md
- Next up: team structure decision, then implementation starting with F001 (Neon
  migrations + provisioning runbook — Ovidiu provisions Neon himself from the runbook)

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

### Patterns
- (none yet)

### Gotchas
- Coverage tooling gap: `mcp-server` has a `test:coverage` script but `@vitest/coverage-v8`
  is not in devDependencies, so coverage cannot be measured yet. The 95% coverage gate is
  blocked until the dependency is added — fold this into the first migration feature.
- LLM responses need markdown fence stripping (```json ... ```) before JSON.parse
- PostgreSQL UNION ALL with ORDER BY/LIMIT needs parenthesized subqueries (migration 005)

## Meta-Patterns
<!-- Coordination insights that apply across features — NOT domain-specific.
     Populated by the retrospective step at session end.
     These transfer to new projects: harness-init can import them as starting context. -->
- (none yet — first retrospective will populate this)
