# Security Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all CRITICAL and HIGH findings from the security audit, address key MEDIUM findings.

**Architecture:** Three parallel workstreams — (A) error handling & observability, (B) auth & crypto hardening, (C) input validation & prompt injection defense. Each workstream is independent and can be dispatched to a separate agent.

**Tech Stack:** TypeScript, Node.js crypto, Deno crypto.subtle, Supabase Edge Functions, Express, MCP SDK

---

## Workstream A: Error Handling & Observability

Fixes: CRITICAL #1-4, HIGH #9-12

### Task A1: Log Promise.allSettled rejection reasons in capture pipeline

**Files:**
- Modify: `mcp-server/src/services/capture.ts:39-50`
- Test: `mcp-server/src/services/capture.test.ts`

**Step 1: Write failing test**

Add test to `capture.test.ts`:

```typescript
it('should log rejection reason when embedding throws unexpected error', async () => {
  const consoleSpy = vi.spyOn(console, 'error');
  vi.mocked(generateEmbedding).mockRejectedValueOnce(new Error('runtime crash'));
  vi.mocked(extractMetadata).mockResolvedValueOnce({
    metadata: DEGRADED_METADATA,
    status: 'degraded',
  });

  const result = await captureMemory({ text: 'test', source: 'api' });
  expect(result.embedding_status).toBe('pending');
  expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('runtime crash'));
  consoleSpy.mockRestore();
});
```

**Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run src/services/capture.test.ts -t "rejection reason"`
Expected: FAIL — console.error not called with the rejection reason

**Step 3: Implement fix**

In `capture.ts`, after the `Promise.allSettled` call (line 44), add logging:

```typescript
if (embeddingResult.status === 'rejected') {
  console.error(`[capture] Embedding rejected: ${embeddingResult.reason}`);
}
if (metadataResult.status === 'rejected') {
  console.error(`[capture] Metadata rejected: ${metadataResult.reason}`);
}
```

**Step 4: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run src/services/capture.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add mcp-server/src/services/capture.ts mcp-server/src/services/capture.test.ts
git commit -m "fix(security): log Promise.allSettled rejection reasons in capture pipeline"
```

---

### Task A2: Health endpoint — return 503 on DB failure, log errors

**Files:**
- Modify: `mcp-server/src/transport/sse.ts:64-83`

**Step 1: Implement fix**

Replace the catch block at line 77:

```typescript
} catch (err) {
  const message = err instanceof Error ? err.message : 'Unknown error';
  console.error(`[health] DB health check failed: ${message}`);
  res.status(503).json({
    status: 'degraded',
    db_connected: false,
  });
}
```

**Step 2: Verify build**

Run: `cd mcp-server && npm run build`
Expected: Clean compile

**Step 3: Commit**

```bash
git add mcp-server/src/transport/sse.ts
git commit -m "fix(security): health endpoint returns 503 on DB failure, logs errors"
```

---

### Task A3: Remove non-null assertions in SSE transport

**Files:**
- Modify: `mcp-server/src/transport/sse.ts:92-93,98-102`

**Step 1: Replace non-null assertions with guards**

At lines 92-93, replace:
```typescript
const token = req.headers.authorization!.slice(7);
const jwtSecret = process.env.CAPTURE_JWT_SECRET!;
```

With:
```typescript
const authHeader = req.headers.authorization;
if (!authHeader) { res.status(401).json({ error: 'UNAUTHORIZED' }); return; }
const token = authHeader.slice(7);

const jwtSecret = process.env.CAPTURE_JWT_SECRET;
if (!jwtSecret) {
  console.error('[sse] CAPTURE_JWT_SECRET not configured');
  res.status(500).json({ error: 'Server misconfigured' });
  return;
}
```

**Step 2: Fix setTimeout write-after-close**

At lines 98-102, wrap in try-catch and save timeout for cleanup:

```typescript
const expiryTimer = setTimeout(() => {
  try {
    if (!res.writableEnded) {
      res.write(`event: auth_expired\ndata: {}\n\n`);
    }
  } catch (err) {
    console.error(`[sse] Failed to write auth_expired: ${err instanceof Error ? err.message : err}`);
  }
  transport.close();
  transports.delete(sessionId);
}, expiresIn);

res.on('close', () => {
  clearTimeout(expiryTimer);
  transports.delete(sessionId);
});
```

Remove the existing `res.on('close')` handler if it exists separately to avoid duplication.

**Step 3: Verify build**

Run: `cd mcp-server && npm run build`
Expected: Clean compile

**Step 4: Commit**

```bash
git add mcp-server/src/transport/sse.ts
git commit -m "fix(security): remove non-null assertions, guard SSE write-after-close"
```

---

### Task A4: Distinguish permanent vs transient failures in embedding service

**Files:**
- Modify: `mcp-server/src/services/embedding.ts:10-28`
- Test: `mcp-server/src/services/capture.test.ts`

**Step 1: Implement fix**

Restructure `generateEmbedding` to let config errors throw through:

```typescript
export async function generateEmbedding(text: string): Promise<number[] | null> {
  // Config errors should NOT be caught — they are permanent
  const openai = getClient(); // throws if OPENAI_API_KEY missing

  try {
    const response = await openai.embeddings.create({
      model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
      input: text,
    });
    return response.data[0]?.embedding ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown embedding error';
    console.error(`[embedding] Failed to generate embedding: ${message}`);
    return null;
  }
}
```

**Step 2: Update capture.test.ts**

Add test that config errors propagate:

```typescript
it('should throw when OpenAI API key is missing (permanent failure)', async () => {
  vi.mocked(generateEmbedding).mockRejectedValueOnce(new Error('OPENAI_API_KEY must be set'));
  vi.mocked(extractMetadata).mockResolvedValueOnce({
    metadata: DEGRADED_METADATA,
    status: 'degraded',
  });

  const consoleSpy = vi.spyOn(console, 'error');
  const result = await captureMemory({ text: 'test', source: 'api' });
  expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('OPENAI_API_KEY'));
  consoleSpy.mockRestore();
});
```

**Step 3: Run tests**

Run: `cd mcp-server && npx vitest run`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add mcp-server/src/services/embedding.ts mcp-server/src/services/capture.test.ts
git commit -m "fix(security): let permanent config errors propagate from embedding service"
```

---

### Task A5: Add error handling to search_brain, list_recent, get_stats tool handlers

**Files:**
- Modify: `mcp-server/src/index.ts:50-80`

**Step 1: Implement fix**

Wrap each handler in try-catch matching the capture_memory pattern. For each of the three tools (search_brain ~line 50, list_recent ~line 65, get_stats ~line 76):

```typescript
async (params) => {
  try {
    const results = await handleSearchBrain(params);
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error(`[search_brain] ${message}`);
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'SEARCH_FAILED', message: 'Failed to search memories' }) }], isError: true };
  }
},
```

Apply the same pattern to `list_recent` (error: `LIST_FAILED`, message: `Failed to list memories`) and `get_stats` (error: `STATS_FAILED`, message: `Failed to get stats`).

**Step 2: Verify build**

Run: `cd mcp-server && npm run build`
Expected: Clean compile

**Step 3: Commit**

```bash
git add mcp-server/src/index.ts
git commit -m "fix(security): add error handling to search, list, and stats tool handlers"
```

---

### Task A6: Add terminal failure state for metadata retries

**Files:**
- Modify: `mcp-server/src/db/queries.ts:261-291`
- Modify: `supabase/functions/retry-worker/index.ts:203-210`

**Step 1: Fix incrementMetadataRetry in queries.ts**

Add terminal failure logic matching the embedding pattern. After line 280 (`const newCount = ...`), add:

```typescript
const MAX_METADATA_RETRIES = 10;

if (newCount >= MAX_METADATA_RETRIES) {
  const { error: updateError } = await supabase
    .from('memories')
    .update({
      retry_count_metadata: newCount,
      metadata_status: 'failed',
      last_processing_error: processingError,
    })
    .eq('id', id);

  if (updateError) {
    throw new Error(`Failed to mark metadata as failed for ${id}: ${updateError.message}`);
  }
  return;
}
```

Note: This requires `metadata_status` to accept `'failed'` as a value. Check the DB constraint in migration 002 — if the CHECK constraint only allows `('ready','degraded')`, add a new migration `008_add_metadata_failed_status.sql`:

```sql
ALTER TABLE memories DROP CONSTRAINT IF EXISTS metadata_status_valid;
ALTER TABLE memories ADD CONSTRAINT metadata_status_valid
  CHECK (metadata_status IN ('ready', 'degraded', 'failed'));
```

**Step 2: Fix retry worker**

In `supabase/functions/retry-worker/index.ts`, at the metadata retry catch block (~line 249), add:

```typescript
if (newCount >= MAX_METADATA_RETRIES) {
  const { error: failError } = await supabase
    .from('memories')
    .update({
      retry_count_metadata: newCount,
      metadata_status: 'failed',
      last_processing_error: errorMsg,
    })
    .eq('id', record.id);

  if (failError) {
    console.error(`Failed to mark metadata as failed for ${record.id}: ${failError.message}`);
  }
} else {
  // existing update logic
}
```

**Step 3: Run migration**

Run: `cd /Users/fameftimie/work/openBrain/open-brain && npx supabase db push`

**Step 4: Rebuild and test**

Run: `cd mcp-server && npm run build && npx vitest run`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add supabase/migrations/008_add_metadata_failed_status.sql mcp-server/src/db/queries.ts supabase/functions/retry-worker/index.ts
git commit -m "fix(security): add terminal 'failed' state for metadata retries"
```

---

### Task A7: Differentiate RPC-not-found from real errors in retry worker

**Files:**
- Modify: `supabase/functions/retry-worker/index.ts:315-347`

**Step 1: Implement fix**

Replace the blanket fallback with error-type checking:

```typescript
if (queryError) {
  const isNotFound = queryError.message.includes('function') ||
                     queryError.message.includes('does not exist') ||
                     queryError.code === '42883'; // PostgreSQL "undefined function"

  if (!isNotFound) {
    console.error(`[retry-worker] RPC failed with unexpected error: ${queryError.message}`);
    return new Response(JSON.stringify({ error: 'RPC query failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.warn(`[retry-worker] RPC not found, using fallback query`);
  // ... existing fallback query
}
```

**Step 2: Verify build**

Deploy: `npx supabase functions deploy retry-worker --no-verify-jwt`

**Step 3: Commit**

```bash
git add supabase/functions/retry-worker/index.ts
git commit -m "fix(security): differentiate RPC-not-found from real errors in retry worker"
```

---

## Workstream B: Auth & Crypto Hardening

Fixes: HIGH #5-6, MEDIUM #13-16

### Task B1: Add HMAC replay protection with timestamp validation

**Files:**
- Modify: `mcp-server/src/auth/hmac.ts`
- Modify: `mcp-server/src/auth/middleware.ts:28-43`
- Modify: `supabase/functions/capture/index.ts:149-174,180-217`
- Test: `mcp-server/src/auth/hmac.test.ts`

**Step 1: Write failing tests**

Add to `hmac.test.ts`:

```typescript
describe('verifyHmacWithTimestamp', () => {
  it('should reject requests older than 5 minutes', () => {
    const secret = 'test-secret';
    const body = Buffer.from('test body');
    const oldTimestamp = Math.floor(Date.now() / 1000) - 301; // 5min + 1sec ago
    const payload = `${oldTimestamp}.${body.toString()}`;
    const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
    expect(verifyHmac(body, sig, secret, oldTimestamp.toString())).toBe(false);
  });

  it('should accept requests within 5 minutes', () => {
    const secret = 'test-secret';
    const body = Buffer.from('test body');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = `${timestamp}.${body.toString()}`;
    const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
    expect(verifyHmac(body, sig, secret, timestamp)).toBe(true);
  });

  it('should reject missing timestamp', () => {
    const secret = 'test-secret';
    const body = Buffer.from('test body');
    const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyHmac(body, sig, secret, undefined)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run src/auth/hmac.test.ts`
Expected: FAIL — verifyHmac doesn't accept timestamp parameter yet

**Step 3: Implement HMAC with timestamp**

Update `hmac.ts`:

```typescript
const MAX_TIMESTAMP_AGE_SECONDS = 300; // 5 minutes

export function verifyHmac(
  rawBody: Buffer,
  signature: string,
  secret: string,
  timestamp?: string,
): boolean {
  if (!signature.startsWith(SIGNATURE_PREFIX)) return false;

  // Timestamp is required for replay protection
  if (!timestamp) return false;

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_TIMESTAMP_AGE_SECONDS) return false;

  const providedHex = signature.slice(SIGNATURE_PREFIX.length);
  let providedBuffer: Buffer;
  try {
    providedBuffer = Buffer.from(providedHex, 'hex');
  } catch {
    return false;
  }

  // Sign timestamp.body to prevent replay
  const payload = `${timestamp}.${rawBody.toString()}`;
  const computed = crypto.createHmac('sha256', secret).update(payload).digest();

  if (providedBuffer.length !== computed.length) return false;
  return crypto.timingSafeEqual(providedBuffer, computed);
}
```

**Step 4: Update middleware.ts**

In `authenticateCapture`, extract the timestamp header:

```typescript
const timestampHeader = req.headers['x-openbrain-timestamp'] as string | undefined;
```

Pass it to verifyHmac:

```typescript
if (!verifyHmac(rawBody, hmacHeader, hmacSecret, timestampHeader)) {
```

**Step 5: Update edge function capture/index.ts**

In `verifyHmacSignature`, add timestamp parameter and validation (same logic as Node version but using Deno's crypto.subtle).

In `authenticate`, extract timestamp:
```typescript
const timestampHeader = req.headers.get('X-OpenBrain-Timestamp');
```

Pass to verification:
```typescript
const valid = await verifyHmacSignature(rawBody, sigHeader, webhookSecret, timestampHeader);
```

**Step 6: Update existing HMAC tests**

All existing tests that call `verifyHmac` need to pass a valid timestamp. Update each call to include `Math.floor(Date.now() / 1000).toString()` as the 4th parameter, and update the signed payload to `${timestamp}.${body}`.

**Step 7: Run all tests**

Run: `cd mcp-server && npx vitest run`
Expected: ALL PASS

**Step 8: Commit**

```bash
git add mcp-server/src/auth/hmac.ts mcp-server/src/auth/hmac.test.ts mcp-server/src/auth/middleware.ts supabase/functions/capture/index.ts
git commit -m "fix(security): add HMAC replay protection with 5-minute timestamp validation"
```

---

### Task B2: Timing-safe client secret comparison in SSE transport

**Files:**
- Modify: `mcp-server/src/transport/sse.ts:48`

**Step 1: Implement fix**

Replace line 48:
```typescript
if (client_secret !== expectedSecret) {
```

With:
```typescript
const secretsMatch = client_secret.length === expectedSecret.length &&
  crypto.timingSafeEqual(Buffer.from(client_secret), Buffer.from(expectedSecret));
if (!secretsMatch) {
```

Add import at top of file:
```typescript
import crypto from 'node:crypto';
```

**Step 2: Verify build**

Run: `cd mcp-server && npm run build`
Expected: Clean compile

**Step 3: Commit**

```bash
git add mcp-server/src/transport/sse.ts
git commit -m "fix(security): use timing-safe comparison for client secret"
```

---

### Task B3: Restrict CORS on capture edge function

**Files:**
- Modify: `supabase/functions/capture/index.ts:16-21`

**Step 1: Implement fix**

Replace wildcard CORS with no CORS (server-to-server only):

```typescript
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-OpenBrain-Signature, X-OpenBrain-Timestamp',
  'Access-Control-Max-Age': '86400',
};
```

Or remove CORS headers entirely and just handle OPTIONS with 204. If browser-based capture is needed later, make the origin configurable via env var.

**Step 2: Deploy**

Run: `npx supabase functions deploy capture --no-verify-jwt`

**Step 3: Commit**

```bash
git add supabase/functions/capture/index.ts
git commit -m "fix(security): remove wildcard CORS from capture edge function"
```

---

### Task B4: Timing-safe comparison in retry worker auth

**Files:**
- Modify: `supabase/functions/retry-worker/index.ts:293`

**Step 1: Implement fix**

Replace:
```typescript
if (authHeader !== `Bearer ${serviceRoleKey}`) {
```

With constant-time comparison using Deno's crypto.subtle:

```typescript
const expected = `Bearer ${serviceRoleKey}`;
if (authHeader.length !== expected.length) {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, ... });
}
const encoder = new TextEncoder();
const a = encoder.encode(authHeader);
const b = encoder.encode(expected);
const key = await crypto.subtle.importKey('raw', a, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const sigA = new Uint8Array(await crypto.subtle.sign('HMAC', key, a));
const sigB = new Uint8Array(await crypto.subtle.sign('HMAC', key, b));
let diff = 0;
for (let i = 0; i < sigA.length; i++) diff |= sigA[i] ^ sigB[i];
if (diff !== 0) {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, ... });
}
```

**Step 2: Deploy**

Run: `npx supabase functions deploy retry-worker --no-verify-jwt`

**Step 3: Commit**

```bash
git add supabase/functions/retry-worker/index.ts
git commit -m "fix(security): use timing-safe comparison in retry worker auth"
```

---

## Workstream C: Input Validation & Prompt Injection Defense

Fixes: HIGH #7-8, MEDIUM #17-18

### Task C1: Use system/user message separation in MCP metadata extraction

**Files:**
- Modify: `mcp-server/src/services/metadata.ts:60-79`
- Modify: `prompts/metadata-extraction.txt`

**Step 1: Implement fix**

The edge function already uses system/user separation correctly. Port that pattern to the MCP server.

In `extractWithAnthropic`, change from single user message with embedded prompt to system + user:

```typescript
async function extractWithAnthropic(userText: string): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const systemPrompt = loadPrompt(); // Load the system instructions only
  const userMessage = `<user_input>\n${userText}\n</user_input>`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  // ... rest unchanged
}
```

Update `buildPrompt` to no longer do template substitution — it should just return the raw text (possibly truncated) and the system prompt separately.

For `extractWithOpenAI`, use separate system and user messages:
```typescript
messages: [
  { role: 'system', content: systemPrompt },
  { role: 'user', content: `<user_input>\n${userText}\n</user_input>` },
],
```

Update `prompts/metadata-extraction.txt` to be the system prompt only (remove the `{{raw_text}}` placeholder).

**Step 2: Verify build and tests**

Run: `cd mcp-server && npm run build && npx vitest run`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add mcp-server/src/services/metadata.ts prompts/metadata-extraction.txt
git commit -m "fix(security): use system/user message separation for prompt injection defense"
```

---

### Task C2: Add metadata validation to edge function

**Files:**
- Modify: `supabase/functions/capture/index.ts:255-294`

**Step 1: Implement fix**

Port the `validateMetadata` function from `mcp-server/src/services/metadata.ts` to the edge function. Add it after the `extractMetadata` function:

```typescript
const VALID_TYPES = new Set([
  'decision', 'insight', 'person_note', 'meeting_debrief',
  'task', 'reference', 'note', 'meeting_note', 'unknown',
]);

function validateMetadata(raw: Record<string, unknown>): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;

  const type = typeof raw.type === 'string' && VALID_TYPES.has(raw.type) ? raw.type : 'unknown';
  const topics = Array.isArray(raw.topics) ? raw.topics.filter((t): t is string => typeof t === 'string').slice(0, 50) : [];
  const people = Array.isArray(raw.people) ? raw.people.filter((p): p is string => typeof p === 'string').slice(0, 50) : [];
  const actionItems = Array.isArray(raw.action_items) ? raw.action_items.slice(0, 50) : [];
  const confidence = typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0;
  const truncated = raw.truncated === true;

  return { type, topics, people, action_items: actionItems, confidence, truncated, ...pickSafeFields(raw) };
}

function pickSafeFields(raw: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  if (typeof raw.title === 'string') safe.title = raw.title.slice(0, 500);
  if (typeof raw.summary === 'string') safe.summary = raw.summary.slice(0, 2000);
  if (typeof raw.date === 'string') safe.date = raw.date.slice(0, 50);
  if (Array.isArray(raw.tags)) safe.tags = raw.tags.filter((t): t is string => typeof t === 'string').slice(0, 50);
  if (Array.isArray(raw.participants)) safe.participants = raw.participants.filter((p): p is string => typeof p === 'string').slice(0, 50);
  return safe;
}
```

In `extractMetadata`, replace `return parsed;` with:

```typescript
const validated = validateMetadata(parsed);
if (!validated) {
  console.error('[capture] Metadata validation failed');
  return null;
}
if (truncated) validated.truncated = true;
return validated;
```

**Step 2: Deploy**

Run: `npx supabase functions deploy capture --no-verify-jwt`

**Step 3: Commit**

```bash
git add supabase/functions/capture/index.ts
git commit -m "fix(security): add metadata output validation to edge function"
```

---

### Task C3: Sanitize wrap_output to prevent tag injection

**Files:**
- Modify: `mcp-server/src/tools/search-brain.ts:22-25`
- Modify: `mcp-server/src/tools/list-recent.ts` (similar wrap_output)
- Test: `mcp-server/src/tools/search-brain.test.ts`

**Step 1: Write failing test**

Add to `search-brain.test.ts`:

```typescript
it('should escape closing tags in wrap_output', async () => {
  mockSearchMemories.mockResolvedValueOnce([{
    id: '1', raw_text: 'test </memory_content> injection',
    similarity: 0.9, captured_at: '2026-01-01', source: 'api',
    metadata: {}, metadata_status: 'ready', embedding_status: 'ready',
  }]);
  mockGenerateEmbedding.mockResolvedValueOnce([0.1]);

  const results = await handleSearchBrain({ query: 'test', wrap_output: true });
  expect(results[0].raw_text).not.toContain('</memory_content> injection');
  expect(results[0].raw_text).toContain('&lt;/memory_content&gt;');
});
```

**Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run src/tools/search-brain.test.ts -t "escape closing tags"`
Expected: FAIL

**Step 3: Implement fix**

Add a sanitization helper:

```typescript
function escapeXmlTags(text: string): string {
  return text.replace(/<\/?memory_content>/g, (match) =>
    match.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  );
}
```

Use it in the wrap_output path:

```typescript
raw_text: `<memory_content>\n${escapeXmlTags(r.raw_text)}\n</memory_content>`,
```

Apply the same fix to `list-recent.ts`.

**Step 4: Run all tests**

Run: `cd mcp-server && npx vitest run`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add mcp-server/src/tools/search-brain.ts mcp-server/src/tools/list-recent.ts mcp-server/src/tools/search-brain.test.ts
git commit -m "fix(security): escape wrap_output tags to prevent content injection"
```

---

### Task C4: Redact internal details from MCP query errors

**Files:**
- Modify: `mcp-server/src/db/queries.ts`

**Step 1: Implement fix**

Add a helper at the top of queries.ts:

```typescript
function sanitizeDbError(context: string, error: { message: string }): Error {
  console.error(`[db] ${context}: ${error.message}`);
  return new Error(`Database operation failed: ${context}`);
}
```

Replace all `throw new Error(`Failed to X: ${error.message}`)` with `throw sanitizeDbError('X', error)`. This logs the real error server-side but returns a generic message to clients.

Apply to: `insertMemory`, `searchMemories`, `listRecentMemories`, `getStats`, `getSystemConfig`, `updateMemoryEmbedding`, `updateMemoryMetadata`, `incrementEmbeddingRetry`, `incrementMetadataRetry`.

**Step 2: Run tests**

Run: `cd mcp-server && npx vitest run`
Expected: ALL PASS (error messages in tests may need updating if they assert on exact error text)

**Step 3: Commit**

```bash
git add mcp-server/src/db/queries.ts
git commit -m "fix(security): redact internal DB error details from client-facing messages"
```

---

## Execution Summary

| Workstream | Tasks | Findings Addressed |
|------------|-------|--------------------|
| A: Error Handling | A1-A7 (7 tasks) | CRITICAL #1-4, HIGH #9-12 |
| B: Auth & Crypto | B1-B4 (4 tasks) | HIGH #5-6, MEDIUM #13-16 |
| C: Input Validation | C1-C4 (4 tasks) | HIGH #7-8, MEDIUM #17-18 |

**Total: 15 tasks, 3 parallel workstreams**

After all tasks complete:
1. Run full test suite: `cd mcp-server && npx vitest run`
2. Build: `cd mcp-server && npm run build`
3. Deploy edge functions: `npx supabase functions deploy capture --no-verify-jwt && npx supabase functions deploy retry-worker --no-verify-jwt`
4. Run migration 008 if created: `npx supabase db push`
5. Smoke test capture pipeline
6. Push to GitHub
