export interface Env {
  DATABASE_URL: string;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_METADATA_API_KEY?: string;
  METADATA_LLM_PROVIDER?: string;
}
