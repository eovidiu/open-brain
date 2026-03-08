# Setup Wizard Design: `openbrain setup`

## Overview

Interactive CLI that takes a fresh clone of open-brain from zero to running in a single command.
Collects credentials, validates them live, generates secrets, runs migrations, deploys edge functions, and optionally wires up Claude Desktop.

Uses `@clack/prompts` for terminal UI. Every step is idempotent: re-running picks up where it left off.

---

## 1. CLI UX Flow

```
$ npx open-brain setup

  open-brain setup v1.0.0

  Step 1 of 7: Supabase Connection
  --------------------------------
  ? Supabase project URL: https://xyzabc.supabase.co
  ? Supabase service role key: ••••••••••••••••••••
  ✔ Connected to Supabase (project: xyzabc, region: us-east-1)

  Step 2 of 7: OpenAI API Key
  ----------------------------
  ? OpenAI API key: ••••••••••••••••
  ✔ Key valid (org: org-xxx, embedding model text-embedding-3-small available)

  Step 3 of 7: Anthropic API Key (metadata extraction)
  ----------------------------------------------------
  ? Anthropic API key (or press Enter to use OpenAI for metadata): ••••••••
  ✔ Key valid (claude-haiku-4-5 accessible)

  Step 4 of 7: Generate Secrets
  ------------------------------
  ◆ Generated CAPTURE_WEBHOOK_SECRET (256-bit hex)
  ◆ Generated CAPTURE_JWT_SECRET (256-bit hex)
  ◆ Generated MCP_CLIENT_SECRET (48-char base64url)
  ✔ Secrets written to .env

  Step 5 of 7: Database Migrations
  ---------------------------------
  ✔ 001_enable_extensions.sql — already applied
  ✔ 002_create_memories.sql — already applied
  ↻ 003_create_system_config.sql — applying...
  ✔ 003_create_system_config.sql — applied
  ✔ 004_enable_rls.sql — applied
  ✔ 005_create_retry_function.sql — applied
  ✔ 006_create_rpc_functions.sql — applied
  ✔ 007_create_retry_eligible_rpc.sql — applied

  Step 6 of 7: Deploy Edge Functions
  -----------------------------------
  ↻ Deploying capture...
  ✔ capture deployed (https://xyzabc.supabase.co/functions/v1/capture)
  ↻ Deploying retry-worker...
  ✔ retry-worker deployed

  Step 7 of 7: Claude Desktop Integration (optional)
  ---------------------------------------------------
  ? Configure Claude Desktop MCP integration? (Y/n): Y
  ✔ Added open-brain to ~/Library/Application Support/Claude/claude_desktop_config.json

  ────────────────────────────────
  Setup complete.

  Start the MCP server:
    npm run dev

  Or in stdio mode (for Claude Desktop):
    npx open-brain-mcp-server --stdio
```

### Re-run behavior

On re-run, the wizard detects existing state and shows:

```
  Step 1 of 7: Supabase Connection
  ✔ Already configured (https://xyzabc.supabase.co)
  ? Reconfigure? (y/N): N
  ⊘ Skipped
```

Each step has three possible states: `done` (skip), `partial` (resume), `not started` (run).

---

## 2. Validation at Each Step

| Step | What we validate | How |
|------|-----------------|-----|
| Supabase URL + key | URL format matches `https://*.supabase.co`, key starts with `eyJ`. Then test: `supabase.from('_non_existent').select('*').limit(0)` — a 200 with empty data confirms the connection works (RLS won't block service role). | Supabase JS client call |
| OpenAI API key | `POST /v1/embeddings` with model `text-embedding-3-small`, input `"test"`, dimensions `1536`. Costs ~$0.000001. Success = key valid and model accessible. | Tiny real API call |
| Anthropic API key | `POST /v1/messages` with model `claude-haiku-4-5-20251001`, max_tokens `1`, content `"hi"`. Costs ~$0.00001. Check for 200 status. | Tiny real API call |
| Secret generation | No external validation needed. Use `crypto.randomBytes(32).toString('hex')` for HMAC/JWT secrets, `crypto.randomBytes(36).toString('base64url')` for MCP client secret. | Local crypto |
| Migrations | Each migration is wrapped in `IF NOT EXISTS` / `CREATE OR REPLACE`. Before running, check if the target object exists (query `information_schema.tables` for tables, `pg_proc` for functions). Skip if present. | Supabase SQL via `.rpc('exec_sql')` or direct `fetch` to PostgREST |
| Edge functions | Use `supabase functions deploy` CLI or REST API. Check deployment status after. | Supabase CLI |
| Claude Desktop | Check if config file exists at the platform-specific path. Parse JSON, check if `open-brain` server entry already present. | File system read |

### Validation failure handling

Every validation shows the specific error and offers retry:

```
  ✗ OpenAI API key invalid (401 Unauthorized)
  ? Try a different key? (Y/n):
```

Three consecutive failures for the same step exits with a clear message and the step number, so re-run resumes there.

---

## 3. Idempotency

State is tracked in `.env` (credentials) and a `.openbrain-setup.json` lock file:

```json
{
  "version": 1,
  "completedSteps": [1, 2, 3, 4, 5],
  "lastRunAt": "2026-03-08T10:00:00Z",
  "migrationsApplied": [
    "001_enable_extensions",
    "002_create_memories",
    "003_create_system_config"
  ],
  "edgeFunctionsDeployed": ["capture"],
  "claudeDesktopConfigured": false
}
```

Rules:
- `.env` exists with a given var set and non-empty = that credential step is "done"
- A migration is "done" if its target object exists in the database (checked live, not just from the lock file — the lock file is advisory)
- Edge functions are "done" if the Supabase Functions API returns them as deployed
- Claude Desktop is "done" if the config file contains the `open-brain` entry

The lock file is a convenience for fast skipping. The wizard always verifies against the actual source of truth before marking something skipped.

---

## 4. Error Recovery

### Resumption strategy

Each step is independent enough to re-run safely:

| Step | Safe to re-run? | Notes |
|------|----------------|-------|
| Credentials (1-3) | Yes | Overwrite .env var, re-validate |
| Secrets (4) | Yes, but warns | "Secrets already exist. Regenerating will invalidate existing tokens. Regenerate? (y/N)" |
| Migrations (5) | Yes | All SQL uses `IF NOT EXISTS` / `CREATE OR REPLACE`. Individual migration tracking means step 5 resumes from the first unapplied migration. |
| Edge functions (6) | Yes | `supabase functions deploy` is idempotent (overwrites) |
| Claude Desktop (7) | Yes | JSON merge, not overwrite |

### Crash recovery

If the process is killed mid-migration:
1. On re-run, the wizard checks each migration's target object in the DB
2. Applied migrations are skipped
3. The failed migration re-runs (all migrations are idempotent SQL)

No rollback needed — forward-only recovery.

### Partial .env

If `.env` exists with some vars but not others, the wizard only prompts for missing values. Existing values show as `Already configured (sk-...xxxx)` with the option to reconfigure.

---

## 5. Architecture

```
open-brain/
├── mcp-server/           # existing MCP server code
├── supabase/             # existing migrations + functions
├── cli/
│   ├── package.json      # separate workspace package
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts              # entry point, arg parsing
│       ├── setup.ts              # main setup orchestrator
│       ├── steps/
│       │   ├── supabase.ts       # step 1: collect + validate Supabase creds
│       │   ├── openai.ts         # step 2: collect + validate OpenAI key
│       │   ├── anthropic.ts      # step 3: collect + validate Anthropic key
│       │   ├── secrets.ts        # step 4: generate HMAC/JWT/client secrets
│       │   ├── migrations.ts     # step 5: run SQL migrations
│       │   ├── edge-functions.ts # step 6: deploy Supabase edge functions
│       │   └── claude-desktop.ts # step 7: configure Claude Desktop
│       ├── state.ts              # read/write .openbrain-setup.json
│       ├── env.ts                # read/write .env file (preserves comments)
│       ├── validate.ts           # API key validation helpers
│       └── ui.ts                 # @clack/prompts wrappers, consistent styling
├── package.json          # root workspace — add "cli" to workspaces array
└── .env.example
```

### Step interface

Every step implements:

```typescript
interface SetupStep {
  name: string;
  number: number;
  isComplete(state: SetupState, env: EnvFile): Promise<boolean>;
  run(state: SetupState, env: EnvFile): Promise<StepResult>;
}

type StepResult =
  | { status: 'done' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string; retriable: boolean };
```

The orchestrator in `setup.ts` loops through steps, checks `isComplete`, prompts to skip or reconfigure, calls `run`, and updates state.

### Dependencies

```json
{
  "dependencies": {
    "@clack/prompts": "^0.9",
    "@supabase/supabase-js": "^2.49",
    "dotenv": "^16.4"
  },
  "devDependencies": {
    "typescript": "^5.8",
    "tsx": "^4.19"
  }
}
```

No dependency on the Supabase CLI for migrations — run SQL directly via the management API or via `supabase-js` RPC. For edge function deployment, shell out to `supabase functions deploy` (require it as a prerequisite) or use the Supabase Management API.

---

## 6. Package.json bin Entry

Root `package.json` adds the cli workspace:

```json
{
  "workspaces": ["mcp-server", "cli"]
}
```

`cli/package.json`:

```json
{
  "name": "open-brain-cli",
  "version": "1.0.0-mvp",
  "type": "module",
  "bin": {
    "openbrain": "./dist/index.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts"
  }
}
```

`cli/src/index.ts` starts with:

```typescript
#!/usr/bin/env node
import { runSetup } from './setup.js';

const command = process.argv[2];

if (command === 'setup') {
  runSetup();
} else {
  console.log('Usage: openbrain setup');
  process.exit(1);
}
```

After `npm run build` in the cli workspace, `npx openbrain setup` works from the repo root. For global install: `npm install -g ./cli`.

---

## 7. Distribution

### Option A: npx from repo (recommended for now)

Users clone the repo, then:

```bash
npm install
npx openbrain setup
```

This is the simplest path for a personal/small-team tool. No npm registry needed.

### Option B: Published npm package (future)

```bash
npx open-brain-cli setup
```

Publish `open-brain-cli` to npm. The `setup` command would need the repo checked out (it reads `supabase/migrations/*.sql` and `supabase/functions/*` from disk), so it either:
- Bundles the SQL/function source in the package (`files` field)
- Or downloads them from the GitHub repo at runtime

Recommendation: start with Option A. Move to Option B only if distribution beyond a single developer becomes a real need.

### Option C: Single-file npx script (lightest)

Bundle the entire CLI into a single file with `tsup` or `esbuild`. Ship as a single `.mjs` that can be `npx`'d. Only worth the complexity if there's a strong "zero-install" requirement.

---

## 8. Security Considerations

### Secret generation
- Use `node:crypto.randomBytes()` — not `Math.random()`
- HMAC and JWT secrets: 256-bit (32 bytes), hex-encoded (64 chars)
- MCP client secret: 36 random bytes, base64url-encoded (48 chars)

### Console output
- API keys are NEVER printed in full. Show only last 4 chars: `sk-...abcd`
- Passwords and secrets use `@clack/prompts` `password()` input (masked with dots)
- Error messages from API calls are filtered through a redactor that strips key-like patterns (same `redactError` pattern already in `retry-worker/index.ts`)

### .env file
- After writing `.env`, set file permissions to `0600` (owner read/write only):
  ```typescript
  fs.chmodSync('.env', 0o600);
  ```
- On first run, if `.env` already exists with different permissions, warn the user
- `.env` is already in `.gitignore` (verify during setup, add if missing)

### .openbrain-setup.json
- Contains NO secrets — only step completion status and timestamps
- Safe to commit (but not required)

### Migration execution
- Migrations run via the Supabase service role key over HTTPS — no raw SQL connection string exposed
- Each migration is read from disk, not interpolated with user input — no SQL injection vector

### Edge function secrets
- Edge functions need their own env vars (set via `supabase secrets set`). The setup wizard handles this:
  ```
  supabase secrets set OPENAI_API_KEY=... ANTHROPIC_API_KEY=... \
    CAPTURE_WEBHOOK_SECRET=... CAPTURE_JWT_SECRET=... \
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
  ```
- These are set via the Supabase CLI, which sends them over HTTPS to the management API. They are never stored in edge function source code.

### Supabase CLI requirement
- The wizard checks for `supabase` CLI presence at startup
- If missing, prints install instructions and exits (does not attempt to install it)
- Required for: edge function deployment and `supabase secrets set`
- Not required for: migrations (run via JS client), credential validation

---

## Implementation Notes

### Migration runner detail

Rather than shelling out to `supabase db push`, run migrations through the Supabase JS client using the `exec_sql` RPC or the `/rest/v1/rpc` endpoint with a custom function. This avoids requiring a direct Postgres connection string and works with hosted Supabase without any port forwarding.

Fallback: if the project doesn't have an `exec_sql` RPC, use the Supabase Management API (`POST /v1/projects/{ref}/database/query`) which accepts raw SQL. This requires a Supabase access token (personal access token from dashboard), which the wizard can prompt for.

Simplest path: just require `supabase` CLI and use `supabase db push --db-url` or `supabase migration up`. This avoids building a custom migration runner.

### Claude Desktop config paths

```typescript
function getClaudeDesktopConfigPath(): string {
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    case 'win32':
      return path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
    case 'linux':
      return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}
```

The MCP server entry to add:

```json
{
  "mcpServers": {
    "open-brain": {
      "command": "node",
      "args": ["/absolute/path/to/open-brain/mcp-server/dist/index.js", "--stdio"],
      "env": {
        "SUPABASE_URL": "...",
        "SUPABASE_SERVICE_ROLE_KEY": "...",
        "OPENAI_API_KEY": "...",
        "ANTHROPIC_API_KEY": "...",
        "CAPTURE_WEBHOOK_SECRET": "...",
        "CAPTURE_JWT_SECRET": "...",
        "MCP_CLIENT_SECRET": "...",
        "EMBEDDING_MODEL": "text-embedding-3-small"
      }
    }
  }
}
```

Note: Claude Desktop config gets the actual secret values inlined (it's a local file, not committed). The wizard reads from `.env` and writes them into the config. This is the standard MCP pattern — Claude Desktop doesn't support `.env` files.

### Prerequisite checks (run before step 1)

```
Checking prerequisites...
  ✔ Node.js v20.11.0 (>= 18 required)
  ✔ npm v10.2.0
  ✔ supabase CLI v1.187.0
  ✔ Supabase project linked (or prompt to link)
```

If `supabase` CLI is missing, the wizard can still run steps 1-4 (credential collection and secret generation) but will stop before step 5 with instructions to install it.
