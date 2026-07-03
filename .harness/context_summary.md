# Context Summary

Persistent record of architectural decisions, discovered patterns, gotchas, and active context.
This file is referenced in CLAUDE.md and loaded every session.

## Active Context
- Currently working on: harness initialization; planning Supabase → Neon.tech migration
- Next up: migration feature decomposition, /issue-prep spec review, then implementation

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
