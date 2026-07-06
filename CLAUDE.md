# open-brain

Personal, vendor-neutral, agent-readable knowledge system. Captures thoughts via a
Cloudflare Worker HTTP endpoint, stores them in Neon Postgres + pgvector with
LLM-generated embeddings and metadata, and exposes retrieval through MCP hosts
(local stdio for Claude Desktop; remote Streamable HTTP Worker for everything else).

The authoritative specification is `docs/open-brain-spec.md` (v1.2.0). Prime Rule: the
spec is versioned in git and changed via pull request; verbal amendments have no
standing. Architecture description (C4): `docs/architecture.md`.

## Tech Stack

- TypeScript, Node.js (ESM); npm workspaces `mcp-server/` + `cli/`; standalone
  packages `workers/{shared,capture,retry,mcp}` (each with its own lockfile)
- Vitest for tests (`npm test` at root runs the mcp-server suite; each workers
  package has its own suite)
- Backend: Neon serverless Postgres (pgvector, plain SQL via @neondatabase/serverless)
  + Cloudflare Workers (capture endpoint, retry cron, remote MCP) — all deployed and live
- Embeddings/metadata: OpenAI + Anthropic APIs (keys via env, never committed)

## Commands

```bash
npm ci                 # install all workspace deps
npm run build          # tsc build (mcp-server)
npm test               # vitest run (mcp-server)
.harness/init.sh smoke_test   # fast TypeScript compile check, both workspaces
.harness/init.sh full_test    # compile check + full test suite
```

## Harness

This project uses the Long-Running Agent Harness v3.5.0.

- Feature tracking: `.harness/features.json`
- Context and decisions: `.harness/context_summary.md` (READ THIS at session start)
- Progress handoff: `.harness/claude-progress.txt`
- Build/test: `.harness/init.sh`
- Quality gates: `.claude/hooks/` (TaskCompleted, TeammateIdle, PreToolUse scope + git identity, PostCompact)

Launch Claude Code sessions from this directory (the repo root), not the parent wrapper
directory — hooks and project-scoped state bind to the session launch directory.

## Git Identity

This project uses: Ovidiu Eftimie <eovidiu@gmail.com> with SSH key ~/.ssh/id_ed25519 (github.com).
Always verify identity before push/pull/clone operations.

## Security

- Never read `.env` files (check key names via grep only); `.env.example` documents required vars
- Never commit secrets; API keys live in the environment or platform secret stores
