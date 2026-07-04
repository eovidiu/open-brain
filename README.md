# Open Brain

Personal, vendor-neutral, agent-readable knowledge system.

## Origin

This project is an implementation of a concept articulated by [Nate B Jones](https://www.natebjones.com/) in his Substack article ["Every AI You Use Forgets You — Here's the Fix"](https://natesnewsletter.substack.com/p/every-ai-you-use-forgets-you-heres). Nate has been doing outstanding work at the intersection of AI and personal knowledge management — go read his newsletter.

## What it does

Open Brain gives your AI tools a shared memory. Instead of re-explaining context every time you switch between Claude, ChatGPT, Cursor, or any MCP-compatible client, you capture thoughts once and search them from anywhere. Everything is stored in your own Neon Postgres database with vector embeddings for semantic search, served by Cloudflare Workers — both on free tiers.

## Architecture

```
Claude Desktop (stdio)        Any MCP Client (Streamable HTTP)
        |                                 |
  mcp-server (local)              MCP Worker (Cloudflare)
        |                                 |
        |          Webhooks --> Capture Worker (JWT/HMAC auth)
        |                                 |
        |          Cron (1/min) --> Retry Worker
        |                                 |
        +---------- Neon Postgres + pgvector ----------+
                       |            |
                    OpenAI      Anthropic/OpenAI
                 (embeddings)  (metadata extraction)
```

- **Capture Worker** — HTTP endpoint for saving thoughts (JWT HS256 or HMAC-signed webhooks)
- **Retry Worker** — cron-driven; finishes embedding/metadata for degraded captures
- **MCP Worker** — remote MCP server over Streamable HTTP with JWT auth (`/auth/token`)
- **mcp-server** — local stdio MCP server for Claude Desktop (same four tools)

## Setup

Personal-use scope: you run this from a clone of the repo.

### Prerequisites

| Requirement | What it's for |
|-------------|---------------|
| [Neon](https://neon.tech) account | Postgres + pgvector (free tier) |
| [Cloudflare](https://cloudflare.com) account | Workers hosting (free tier) |
| [OpenAI](https://platform.openai.com) API key | Embeddings |
| [Anthropic](https://console.anthropic.com) API key (optional) | Metadata extraction |
| Node.js 18+ | CLI and MCP server |
| `psql` (`brew install libpq`) | Migration runner |

### Steps

```bash
git clone https://github.com/eovidiu/open-brain.git && cd open-brain
npm ci
npx wrangler login          # one-time Cloudflare auth
npm run dev --workspace=cli # runs `openbrain setup`
```

The setup wizard walks through eight steps: Neon connection string (validated live), OpenAI/Anthropic keys, secret generation, `.env` write, database migrations, Worker deploys (with secrets), and Claude Desktop configuration. Re-running is safe — completed steps are skipped.

Check health anytime:

```bash
npm run dev --workspace=cli status
```

### Connect your AI assistant

**Claude Desktop** — the setup wizard configures this automatically (stdio, local `mcp-server`).

**Claude Code / any Streamable HTTP MCP client** — get a token from the MCP Worker, then point the client at it:

```json
{
  "mcpServers": {
    "open-brain": {
      "type": "http",
      "url": "https://open-brain-mcp.YOUR_SUBDOMAIN.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_JWT"
      }
    }
  }
}
```

Tokens come from `POST /auth/token` with `{"client_secret": "<MCP_CLIENT_SECRET from .env>"}` and expire after an hour.

## What can it do?

Once connected, your AI assistant gets four tools:

| Tool | What it does | Example prompt |
|------|-------------|----------------|
| `capture_memory` | Save a thought, note, or insight | *"Remember that the API deadline is March 15"* |
| `search_brain` | Search your memories by meaning | *"What did I decide about the database?"* |
| `list_recent` | See your latest memories | *"Show me my recent notes"* |
| `get_stats` | See stats about your knowledge base | *"How many memories do I have?"* |

Memories are automatically categorized into types: `decision`, `insight`, `person_note`, `meeting_debrief`, `task`, `reference`, `note`, `meeting_note`.

## Troubleshooting

**"psql not found"** — `brew install libpq`, then `export PATH="/opt/homebrew/opt/libpq/bin:$PATH"`.

**"wrangler is not authenticated"** — run `npx wrangler login` and re-run setup; it resumes at the deploy step.

**Migrations fail on the pooled endpoint** — the runner strips `-pooler` automatically; if running `scripts/migrate.sh` by hand, pass the direct connection string.

**Tools not showing up** — restart your AI client after adding the config, and check the JSON for trailing commas.

## Docs

- [docs/deploy.md](docs/deploy.md) — deployment reference (Workers, secrets, migrations)
- [docs/open-brain-spec.md](docs/open-brain-spec.md) — system specification (authoritative; amended via PR only)
- [docs/neon-provisioning-runbook.md](docs/neon-provisioning-runbook.md) — Neon project provisioning
- [docs/cutover-runbook.md](docs/cutover-runbook.md) — Supabase → Neon cutover record

## Tech Stack

- **TypeScript** — Workers, MCP server, CLI (Node.js ESM)
- **Neon** — serverless Postgres with pgvector (HNSW index, 1536 dimensions)
- **Cloudflare Workers** — capture endpoint, retry cron, remote MCP (Streamable HTTP via the Agents SDK)
- **OpenAI** — `text-embedding-3-small` for embeddings
- **Anthropic / OpenAI** — metadata extraction (type, topics, people, action items)
- **MCP SDK** — `@modelcontextprotocol/sdk` for tool registration and transport

## License

MIT
