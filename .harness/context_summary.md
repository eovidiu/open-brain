# Context Summary

Persistent record of architectural decisions, discovered patterns, gotchas, and active context.
This file is referenced in CLAUDE.md and loaded every session.

## Active Context
- MIGRATION COMPLETE (2026-07-04): F001-F009 all passing, all merged to main and
  pushed. DEPLOYED AND LIVE: capture
  https://open-brain-capture.eovidiu.workers.dev, retry cron (no public route),
  MCP https://open-brain-mcp.eovidiu.workers.dev (/auth/token, /health,
  Streamable HTTP). All live acceptance observed green (docs/cutover-runbook.md).
  Claude Desktop stdio reconfigured against Neon. Supabase lxwtqegyhrfixnfctkne
  PAUSED (rollback bound; permanent delete is a later one-click). Spec lives at
  docs/open-brain-spec.md (v1.1.0, PR #80); ../open-brain-spec.md is a stale
  duplicate.
- OPERATIONAL NOTES: METADATA_LLM_PROVIDER=anthropic everywhere (2026-07-06,
  Ovidiu funded the account $20; live-verified 201 + metadata ready; ~$0.35/mo
  at current volume). OpenAI remains the fallback key. Retry worker keeps the
  OPENAI_METADATA_API_KEY secret (its selectCaller never falls back to
  OPENAI_API_KEY — divergence tracked in F010).
  .env is STALE (still SUPABASE_* keys, no DATABASE_URL) — never modified per
  the no-.env-edits rule; `openbrain setup` regenerates it.
- F010 DONE (2026-07-06): duplicated services consolidated into workers/shared
  (services.ts + queries.ts + db-util.ts, 13 files deleted); the retry
  key-fallback gap and mcp's 7-type/reject-validator divergence are gone by
  construction, with a regression test in shared. Redeployed + live-smoked.
- F011 DONE (2026-07-06): delete_memory tool on both MCP hosts (spec v1.2.0,
  PR #81); hard delete by exact id, explicit NOT_FOUND, no bulk delete.
- Remaining backlog: BI-002 (edit memory), BI-003 (capture events), custom
  domain for capture (workers.dev interim), permanent Supabase delete, stale
  .env regeneration (Ovidiu's 3-minute `openbrain setup` run).
- Neon: project divine-waterfall-85490868 "open-brain", aws-eu-west-2, PG 18,
  branch production (5 migrations); test branch br-morning-morning-ab8igqsz
  gates integration tests via NEON_TEST_DATABASE_URL.

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

### Decisions (Phase 2 review dispositions, 2026-07-04)
- Retry-path metadata validation aligned to capture semantics (coerce-to-unknown +
  caps + sentiment passthrough, never throw on shape): review F1 — the ported
  throw-on-invalid-type burned retry budget to terminal 'failed' while siblings degraded
- Retry overlap: NO row locking added (review F2) — matches source; worst case under
  overlapping cron runs is duplicate LLM spend and double retry_count increment, not
  corruption (success writes idempotent, increments relative, backoff min 30s)
- Duplication debt tracked as F010 (discovered_via F006): consolidate service copies +
  unify VALID_TYPES into workers/shared; review F3's three-way type-list divergence
  is the concrete cost of the accepted Phase-2 duplication

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
- LIVE regression in the legacy Supabase capture function: wildcard CORS was
  reintroduced at supabase/functions/capture/index.ts:17 by 83b19ec (the March
  "security audit fixes" commit — it reverted 6b72bf6's fix, verified via git -S
  2026-07-04). The F004 Worker does NOT carry it. The deployed Supabase function
  stays vulnerable until F008 decommissions it — flagged to Ovidiu
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
- Agent Teams teammates share ONE working tree and ONE git index: teammate A's
  `git rm` staged deletions got swept into teammate B's commit, and B's recovery
  `git reset HEAD^` moved HEAD out from under A mid-commit (2026-07-04, resolved
  with no loss). Avoid by ruling: stage/commit with explicit pathspecs only
  (`git commit -- <own scope>`), never `git add -A`/`git add .`, never
  reset/rebase/checkout in a team session — or use worktree-isolated subagents
  when the CLI documents it for teammates

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
- Agent Teams in one shared working tree: issue pathspec-only git rules (add/commit
  with explicit paths, no reset/rebase/checkout) in the SPAWN PROMPTS, not after the
  first race
- Dependency-removal/porting features: lead greps for orphaned consumers across the
  whole package at plan-approval time and hands the teammate an explicit
  keep/delete list — cheaper than a scope-expansion negotiation mid-implementation
- Cloudflare Worker features: require a wrangler dry-run bundle check in the
  deliverable; unit tests cannot see compat-flag or unresolved-import failures
- Ports must be faithful by default; any added validation/behavior is a defect
  unless it implements a named carry-forward or approved deviation

## Meta-Session 2026-07-06b (F011, single-session)
- Scope vs plan: exactly as planned (spec-first, two db layers, two hosts,
  live proof). Zero corrections, zero expansions; the consolidated shared
  package made the Worker side a 6-line handler.
- Unanticipated: worker server.test asserts registration order against
  TOOL_NAMES — tool registration order is part of that suite's contract;
  register new tools last (or update TOOL_NAMES order deliberately).
- Transferable: for destructive user-facing capabilities, encode the safety
  posture in the SPEC as requirements (exact-id only, explicit not-found)
  before writing code — the FR numbers then become test names and the
  design conversation is already settled when implementation starts.

## Meta-Session 2026-07-06 (F010, single-session)
- Scope vs plan: exactly the four packages named in the feature; no expansions.
  The consolidation deleted 13 files and net-shrank the codebase while adding
  coverage — the review-predicted debt (F3) plus the production incident
  (key fallback) both closed by construction rather than by patching copies.
- Unanticipated: none structural. The fiddly part was test-mock rewiring
  (per-module vi.mock of local files becomes ONE partial mock of the shared
  package per consumer) — mechanical but easy to get subtly wrong; running
  each consumer suite immediately after its rewire kept errors local.
- Transferable: when consolidating duplicated modules, port the RICHEST test
  set into the shared package first and add a named regression test for every
  production incident the duplication caused — the shared suite becomes the
  contract that stops the next divergence at review time. Consumer-side error
  semantics (throw vs degrade) belong in the CONSUMER, not the shared core:
  one throwing core, wrappers choose.

## Meta-Session 2026-07-04c (F008+F009, autonomous deployment under blanket go-ahead)
- Scope vs plan: full deployment executed without user interaction except one
  unavoidable OAuth click (wrangler login — no non-interactive credential path
  existed anywhere on the machine). Secrets flowed shell-side (grep/cut piped
  straight into wrangler) so values never entered the transcript; the one
  exception was the Neon connection string, obtainable only via the Neon MCP.
- Unanticipated (both found ONLY by live testing, invisible to every prior
  test layer): (1) the Anthropic account has no API credits — key valid,
  billing fails; unit tests, dry-runs, and review could never catch an account
  state; (2) retry's metadata key selection never falls back to
  OPENAI_API_KEY, unlike the mcp copy — the F3/F010 duplication-divergence
  materialized as a production incident within hours of the review predicting
  that class of bug.
- Transferable: (a) live acceptance must include one full pass through every
  EXTERNAL account dependency (billing state, quota), not just code paths;
  (b) when a fix changes a Worker secret/var, recompute the retry backoff
  before judging "still broken" — counters incremented by the OLD config push
  eligibility minutes into the future, and a watcher timing out is not a
  failure signal; (c) an editorial mega-edit (1300-line spec) delegates
  cleanly to a context-inheriting fork while the lead keeps deploying.
- Scope vs plan: stayed in cli/ + cli/package.json as declared, plus the
  disclosed init.sh test-gate addition. One plan correction made DURING code
  reading, before any edit: the plan said "delete secrets.ts (superseded by
  wrangler secrets)" but the file generates the secret VALUES — reading all 17
  files before editing caught a wrong deletion a grep of names alone suggested.
- Unanticipated: cli had zero test infrastructure — the "add vitest first"
  ordering was right; coverage gate would have been unmeasurable otherwise.
- Transferable: for interactive CLIs, a thin ui.ts wrapper around the prompt
  library makes every step testable by mocking one module — preserve that
  pattern in any future CLI work. Vitest mock factories for steps need explicit
  Promise<StepResult> typing or mockResolvedValueOnce narrows to the first
  variant and tsc fails.

## Meta-Session 2026-07-04 (F004–F006, Phase 2 complete via Agent Teams)
- Scope accuracy: all three features stayed in their assigned directories; one
  pre-declared expansion (F006 → mcp-server/src/index.ts + package.json, the exact
  same file F002 had to touch for the same reason — dependency-removal features
  reliably orphan consumers outside the named scope). Lead-side consumer grep at
  approval time (jwt/middleware/rate-limiter/hmac) turned the expansion from a
  negotiation into a precise deletion list — do that grep BEFORE approving, always.
- Model calibration: 0 correction cycles on all three Sonnet implementers; the one
  post-hoc defect (F1) was found by the Opus reviewer, not by implementer rework.
  Sonnet implement + Opus review remains the right split for security-sensitive
  ports. Reviewer paid for itself: constant-time compare, alg:none, replay-window
  both-directions checks all confirmed, plus a real medium defect found.
- Discovery lineage: F010 (consolidation) discovered via F006's accepted
  duplication — accepting duplication under parallel scopes converts review
  findings (three-way validator drift) into tracked debt; price was known upfront.
- Approach patterns: (a) teammate-disclosed deviations with reasoning (WebCrypto
  JWT, wrangler dry-run) were consistently better than literal porting — the
  dry-run caught nodejs_compat + an unresolvable import that unit tests could
  never see; require a bundle check for every future Worker feature. (b) The port
  that ADDED unrequested validation (retry's throw-on-invalid-type) was the one
  reviewed defect — "faithful port" beats "improved port" unless the improvement
  is a stated carry-forward. (c) Independent lead verification of teammate claims
  (git -S on the CORS regression) corrected an attribution error before it was
  recorded.
- Plan approval: F006's single approval round-trip resolved four decisions at once
  (health endpoint, JWT library, scope expansion, duplication) — high value for
  pattern-establishing features; correctly skipped for F004/F005.
- Coordination incidents: shared-working-tree git race (see Gotchas) — resolved,
  rules issued mid-session, no recurrence. Platform task-list reset mid-session
  caused duplicate task_assignment notifications; harmless because feature state
  lives in features.json/git, but do not rely on TaskList as the source of truth
  for completion.

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
