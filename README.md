# Open Brain

Personal, vendor-neutral, agent-readable knowledge system.

## Origin

This project is an implementation of a concept articulated by [Nate B Jones](https://www.natebjones.com/) in his Substack article ["Every AI You Use Forgets You — Here's the Fix"](https://natesnewsletter.substack.com/p/every-ai-you-use-forgets-you-heres). Nate has been doing outstanding work at the intersection of AI and personal knowledge management — go read his newsletter.

## What it does

Open Brain gives your AI tools a shared memory. Instead of re-explaining context every time you switch between Claude, ChatGPT, Cursor, or any MCP-compatible client, you capture thoughts once and search them from anywhere. Everything is stored in your own Supabase database with vector embeddings for semantic search.

## Architecture

```
Claude Desktop / Cursor / Any MCP Client
           |
     MCP Server (stdio or SSE)
           |
     Supabase (PostgreSQL + pgvector)
      /           \
OpenAI              Anthropic / OpenAI
(embeddings)        (metadata extraction)
      \           /
   Edge Function: /capture
   Edge Function: /retry-worker (pg_cron)
```

## Quick Start

```bash
git clone https://github.com/eovidiu/open-brain.git
cd open-brain
npx openbrain setup
```

The setup wizard walks you through Supabase project creation, API keys, and MCP client configuration.

## MCP Tools

| Tool | Description | Key Params |
|------|-------------|------------|
| `search_brain` | Semantic search across your knowledge base | `query` (required), `n`, `filter_type`, `since` |
| `list_recent` | List recently captured memories in reverse chronological order | `n`, `filter_type` |
| `get_stats` | Aggregate statistics about your knowledge base | none |
| `capture_memory` | Capture a new thought, note, or insight | `text` (required), `source` |

Memory types: `decision`, `insight`, `person_note`, `meeting_debrief`, `task`, `reference`.

## Manual Setup

If you prefer not to use the wizard:

1. **Create a Supabase project** at [supabase.com](https://supabase.com). See [docs/deploy-to-supabase.md](docs/deploy-to-supabase.md) for details.

2. **Run migrations** in order against your database (SQL Editor or CLI):
   ```bash
   # Files in supabase/migrations/, run 001 through 007
   ```

3. **Deploy edge functions**:
   ```bash
   supabase functions deploy capture
   supabase functions deploy retry-worker
   ```

4. **Set secrets** on your Supabase project:
   ```bash
   supabase secrets set OPENAI_API_KEY=sk-... ANTHROPIC_API_KEY=sk-ant-... CAPTURE_JWT_SECRET=... CAPTURE_WEBHOOK_SECRET=...
   ```

5. **Build the MCP server**:
   ```bash
   cd mcp-server && npm install && npm run build
   ```

6. **Configure your MCP client** — see [examples/](examples/) for Claude Desktop and Cursor configs.

7. **Copy `.env.example` to `.env`** and fill in your values.

## Tech Stack

- **TypeScript** — MCP server and Edge Functions
- **Supabase** — PostgreSQL hosting, Edge Functions, pg_cron
- **pgvector** — vector similarity search (HNSW index, 1536 dimensions)
- **OpenAI** — `text-embedding-3-small` for embeddings
- **Anthropic / OpenAI** — metadata extraction (type, topics, people, action items)
- **MCP SDK** — `@modelcontextprotocol/sdk` for tool registration and transport

## License

MIT
