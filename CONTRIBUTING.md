# Contributing to Open Brain

## Dev Environment Setup

```bash
git clone https://github.com/eovidiu/open-brain.git
cd open-brain
npm install
cp .env.example .env
# Fill in .env with your Supabase and API keys
```

## Build

```bash
cd mcp-server
npm run build
```

## Run Locally

```bash
# stdio mode (for Claude Desktop / Cursor)
node mcp-server/dist/index.js --stdio

# SSE mode (for remote clients)
node mcp-server/dist/index.js --sse-only
```

## Run Tests

```bash
cd mcp-server
npm test              # single run
npm run test:watch    # watch mode
npm run test:coverage # with coverage report
```

## Project Structure

```
mcp-server/src/
  index.ts              # entry point, tool registration
  tools/                # MCP tool handlers
  services/             # embedding, metadata, capture logic
  auth/                 # JWT, HMAC, rate limiting
  db/                   # Supabase client and queries
  transport/            # stdio and SSE transports
supabase/
  migrations/           # SQL migrations (001-007)
  functions/            # Edge Functions (capture, retry-worker)
```

## Pull Request Guidelines

- Include tests for new functionality. Coverage target is 95% for touched code.
- Describe **what** changed and **why** in the PR description.
- Run `npm test` before submitting.
- One logical change per PR.
