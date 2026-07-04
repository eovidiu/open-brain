// Metadata extraction LLM calls and output validation, ported from
// mcp-server/src/services/metadata.ts. Config (provider, API keys) is
// passed in explicitly rather than read from process.env, matching the
// Workers env-binding model. The prompt is inlined (metadata-prompt.ts)
// since Workers have no filesystem to read prompts/metadata-extraction.txt from.
import { CaptureMetadata, DEGRADED_METADATA, VALID_METADATA_TYPES } from '../types.js';
import { METADATA_SYSTEM_PROMPT } from './metadata-prompt.js';

// Spec §5.3: truncate at 6,000 tokens (~24,000 chars at ~4 chars/token).
// Since raw_text max is 10,000 chars (~2,500 tokens), this rarely triggers.
const TRUNCATION_CHARS = 24_000;

export interface MetadataConfig {
  provider?: string;
  openaiApiKey?: string;
  openaiMetadataApiKey?: string;
  anthropicApiKey?: string;
}

function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  return trimmed;
}

function validateMetadata(raw: unknown): CaptureMetadata | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.type !== 'string' || !(VALID_METADATA_TYPES as readonly string[]).includes(obj.type)) {
    return null;
  }

  return {
    type: obj.type as CaptureMetadata['type'],
    topics: Array.isArray(obj.topics) ? obj.topics.filter((t): t is string => typeof t === 'string') : [],
    people: Array.isArray(obj.people) ? obj.people.filter((p): p is string => typeof p === 'string') : [],
    action_items: Array.isArray(obj.action_items)
      ? obj.action_items.filter((a): a is string => typeof a === 'string')
      : [],
    sentiment: ['positive', 'neutral', 'negative', 'mixed'].includes(obj.sentiment as string)
      ? (obj.sentiment as CaptureMetadata['sentiment'])
      : undefined,
    confidence: typeof obj.confidence === 'number' ? Math.max(0, Math.min(1, obj.confidence)) : 0,
    truncated: typeof obj.truncated === 'boolean' ? obj.truncated : false,
  };
}

async function extractWithAnthropic(systemPrompt: string, userText: string, apiKey?: string): Promise<unknown> {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

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
      messages: [{ role: 'user', content: userText }],
    }),
  });

  if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);

  const data = (await response.json()) as { content?: Array<{ type: string; text: string }> };
  const text = data.content?.[0]?.text;
  if (!text) throw new Error('Empty response from Anthropic');

  return JSON.parse(stripMarkdownFences(text));
}

async function extractWithOpenAI(systemPrompt: string, userText: string, apiKey?: string): Promise<unknown> {
  if (!apiKey) throw new Error('OpenAI API key not set for metadata');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
    }),
  });

  if (!response.ok) throw new Error(`OpenAI chat error: ${response.status}`);

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response from OpenAI');

  return JSON.parse(stripMarkdownFences(text));
}

export async function extractMetadata(
  rawText: string,
  config: MetadataConfig,
): Promise<{ metadata: CaptureMetadata; status: 'ready' | 'degraded' }> {
  try {
    const truncated = rawText.length > TRUNCATION_CHARS;
    const text = truncated ? rawText.slice(0, TRUNCATION_CHARS) : rawText;
    const userText = `<user_input>\n${text}\n</user_input>`;
    const provider = config.provider || 'anthropic';

    const raw =
      provider === 'openai'
        ? await extractWithOpenAI(METADATA_SYSTEM_PROMPT, userText, config.openaiMetadataApiKey || config.openaiApiKey)
        : await extractWithAnthropic(METADATA_SYSTEM_PROMPT, userText, config.anthropicApiKey);

    const metadata = validateMetadata(raw);
    if (!metadata) {
      console.error('[metadata] LLM response failed validation');
      return { metadata: DEGRADED_METADATA, status: 'degraded' };
    }

    metadata.truncated = truncated;
    return { metadata, status: 'ready' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown metadata error';
    console.error(`[metadata] Extraction failed: ${message}`);
    return { metadata: DEGRADED_METADATA, status: 'degraded' };
  }
}
