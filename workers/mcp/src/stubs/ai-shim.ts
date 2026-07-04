// Stub for the "ai" package (Vercel AI SDK). The Cloudflare Agents SDK's
// bundle dynamically imports "ai" for chat/tool-calling agent features we
// don't use — we only call createMcpHandler(). esbuild still tries to
// resolve that dynamic import statically, so it's aliased here (see
// wrangler.toml's [alias] section) to avoid pulling in the real dependency
// for a code path this Worker never executes.
export function jsonSchema(schema: unknown): unknown {
  return schema;
}
