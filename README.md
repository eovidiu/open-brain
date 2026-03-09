# Open Brain

Personal, vendor-neutral, agent-readable knowledge system.

## Origin

This project is an implementation of a concept articulated by [Nate B Jones](https://www.natebjones.com/) in his Substack article ["Every AI You Use Forgets You — Here's the Fix"](https://natesnewsletter.substack.com/p/every-ai-you-use-forgets-you-heres). Nate has been doing outstanding work at the intersection of AI and personal knowledge management — go read his newsletter.

## What it does

Open Brain gives your AI tools a shared memory. Instead of re-explaining context every time you switch between Claude, ChatGPT, Cursor, or any MCP-compatible client, you capture thoughts once and search them from anywhere. Everything is stored in your own Supabase database with vector embeddings for semantic search.

## Architecture

```
Claude Desktop / Cursor / Claude Code / Any MCP Client
                    |
              HTTPS (Bearer token)
                    |
         Supabase Edge Function (open-brain-mcp)
              /           \
        OpenAI              Anthropic / OpenAI
      (embeddings)        (metadata extraction)
              \           /
         PostgreSQL + pgvector
```

---

## Setup (3 steps, ~2 minutes)

No coding. No cloning. No terminal wizardry.

### Prerequisites

You need two accounts (both have free tiers):

| Account | What it's for | Sign up |
|---------|---------------|---------|
| **Supabase** | Hosts your database and MCP server | [supabase.com](https://supabase.com) |
| **OpenAI** | Generates search embeddings | [platform.openai.com](https://platform.openai.com) |

You also need **Node.js 18+** and the **Supabase CLI** installed. Check with `node --version` and `npx supabase --version`. If you don't have Node.js, download it from [nodejs.org](https://nodejs.org). For the Supabase CLI: `npm install -g supabase` or `brew install supabase/tap/supabase`.

### Step 1: Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in (or create an account).
2. Click **New Project**.
3. Pick a name (e.g. `open-brain`) and a region close to you.
4. Set a database password (save it somewhere — you won't need it for setup, but it's good to have).
5. Wait ~1 minute for the project to finish provisioning.
6. Go to **Project Settings → API** (left sidebar → the gear icon → API).
7. Copy two values:
   - **Project URL** — looks like `https://xyzabc.supabase.co`
   - **Service role key** — the long one under "service_role" (starts with `eyJ...`)
8. Go to [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) and create a **personal access token**. Copy it — you'll need it during setup.

> **Important:** The service role key and access token have full access. Keep them private. Never share them or commit them to a repo.

### Step 2: Get an OpenAI API key

1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys) and sign in.
2. Click **Create new secret key**.
3. Copy the key (starts with `sk-...`). You'll paste it in the next step.

> **Optional:** If you also have an [Anthropic API key](https://console.anthropic.com/), the setup will ask if you want to use it for better metadata extraction. This is not required — OpenAI works fine for this too.

### Step 3: Run the setup command

Open a terminal and run:

```bash
npx @eovidiu/open-brain-setup
```

The wizard will:
1. Ask you to paste your **Supabase URL** and **service role key** (from Step 1).
2. Ask you to paste your **Supabase access token** (from Step 1).
3. Ask you to paste your **OpenAI API key** (from Step 2).
4. Optionally ask for an **Anthropic API key**.
5. Automatically: create your database tables, generate a secure MCP secret, deploy the MCP server, and set all secrets.
6. Print ready-to-paste **MCP config blocks** for your AI client.

**Save the secret** the wizard prints — you'll need it if you reconfigure later.

### Step 4: Connect your AI assistant

The wizard prints two config blocks. Use the one that matches your client:

#### Claude Desktop / Cursor / Windsurf

These clients use stdio transport. Paste this into your config file (the wizard prints it with your actual URL and secret filled in):

```json
{
  "mcpServers": {
    "open-brain": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://YOUR_PROJECT.supabase.co/functions/v1/open-brain-mcp",
        "--header",
        "Authorization: Bearer YOUR_SECRET_HERE"
      ]
    }
  }
}
```

| Client | Where to paste |
|--------|---------------|
| **Claude Desktop** | Settings → Developer → Edit Config |
| **Cursor** | Settings → MCP Servers → Add |
| **Windsurf** | Settings → MCP → Add Server |

#### Claude Code

Claude Code supports HTTP transport natively. Add to `~/.claude.json` or `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "open-brain": {
      "type": "streamable-http",
      "url": "https://YOUR_PROJECT.supabase.co/functions/v1/open-brain-mcp",
      "headers": {
        "Authorization": "Bearer YOUR_SECRET_HERE"
      }
    }
  }
}
```

Restart the client after pasting. You should see the Open Brain tools available.

**That's it.** Try asking your AI: *"Search my brain for meeting notes"* or *"Remember that I decided to use PostgreSQL for the new project"*.

---

## What can it do?

Once connected, your AI assistant gets four tools:

| Tool | What it does | Example prompt |
|------|-------------|----------------|
| `capture_memory` | Save a thought, note, or insight | *"Remember that the API deadline is March 15"* |
| `search_brain` | Search your memories by meaning | *"What did I decide about the database?"* |
| `list_recent` | See your latest memories | *"Show me my recent notes"* |
| `get_stats` | See stats about your knowledge base | *"How many memories do I have?"* |

Memories are automatically categorized into types: `decision`, `insight`, `person_note`, `meeting_debrief`, `task`, `reference`, `note`, `meeting_note`.

---

## Troubleshooting

**"Supabase CLI not found"** — Install it with `npm install -g supabase` or `brew install supabase/tap/supabase`, then re-run the setup.

**"config.config has invalid keys: project"** — Your Supabase CLI is outdated. Update it with `brew upgrade supabase` or `npm install -g supabase@latest`.

**"Connection failed"** — Double-check your Supabase URL (should be `https://something.supabase.co`) and your service role key (not the anon key — it's the longer one).

**"OpenAI key invalid"** — Make sure you copied the full key. Check your OpenAI billing — free trial keys sometimes expire.

**Tools not showing up** — Restart your AI client after adding the config. Make sure the JSON is valid (no trailing commas).

**Need to reconfigure?** — Run `npx @eovidiu/open-brain-setup` again. It will overwrite the previous deployment.

---

## Advanced

For detailed information about the database schema, edge functions, and manual deployment options, see [docs/deploy-to-supabase.md](docs/deploy-to-supabase.md).

## Tech Stack

- **TypeScript** — MCP server and Edge Functions
- **Supabase** — PostgreSQL hosting, Edge Functions, pg_cron
- **pgvector** — vector similarity search (HNSW index, 1536 dimensions)
- **OpenAI** — `text-embedding-3-small` for embeddings
- **Anthropic / OpenAI** — metadata extraction (type, topics, people, action items)
- **MCP SDK** — `@modelcontextprotocol/sdk` for tool registration and transport

## License

MIT
