// Cloudflare Worker environment bindings, configured via wrangler secrets/vars.
export interface Env {
  DATABASE_URL: string;
  MCP_CLIENT_SECRET: string;
  CAPTURE_JWT_SECRET: string;
  OPENAI_API_KEY: string;
  OPENAI_METADATA_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  METADATA_LLM_PROVIDER?: string;
  EMBEDDING_MODEL?: string;
}
