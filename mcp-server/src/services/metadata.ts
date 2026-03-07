import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import type { MemoryMetadata, MetadataStatus } from '../types.js';
import { DEGRADED_METADATA, VALID_METADATA_TYPES } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = path.resolve(__dirname, '../../../prompts/metadata-extraction.txt');
// Spec §5.3: truncate at 6,000 tokens (~24,000 chars at ~4 chars/token).
// Since raw_text max is 10,000 chars (~2,500 tokens), this rarely triggers.
const TRUNCATION_CHARS = 24_000;

let promptTemplate: string | null = null;

function loadPrompt(): string {
  if (promptTemplate) return promptTemplate;
  promptTemplate = fs.readFileSync(PROMPT_PATH, 'utf-8');
  return promptTemplate;
}

function buildPrompt(rawText: string): { prompt: string; truncated: boolean } {
  const truncated = rawText.length > TRUNCATION_CHARS;
  const text = truncated ? rawText.slice(0, TRUNCATION_CHARS) : rawText;
  const template = loadPrompt();
  return {
    prompt: template.replace('{{raw_text}}', text),
    truncated,
  };
}

function validateMetadata(raw: unknown): MemoryMetadata | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.type !== 'string' || !VALID_METADATA_TYPES.includes(obj.type as typeof VALID_METADATA_TYPES[number])) {
    return null;
  }

  return {
    type: obj.type as MemoryMetadata['type'],
    topics: Array.isArray(obj.topics) ? obj.topics.filter((t): t is string => typeof t === 'string') : [],
    people: Array.isArray(obj.people) ? obj.people.filter((p): p is string => typeof p === 'string') : [],
    action_items: Array.isArray(obj.action_items) ? obj.action_items.filter((a): a is string => typeof a === 'string') : [],
    sentiment: ['positive', 'neutral', 'negative', 'mixed'].includes(obj.sentiment as string)
      ? (obj.sentiment as MemoryMetadata['sentiment'])
      : undefined,
    confidence: typeof obj.confidence === 'number' ? Math.max(0, Math.min(1, obj.confidence)) : 0,
    truncated: typeof obj.truncated === 'boolean' ? obj.truncated : false,
  };
}

async function extractWithAnthropic(prompt: string): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
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
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
  const text = data.content?.[0]?.text;
  if (!text) throw new Error('Empty response from Anthropic');

  return JSON.parse(text);
}

async function extractWithOpenAI(prompt: string): Promise<unknown> {
  const apiKey = process.env.OPENAI_METADATA_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key not set for metadata');

  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1024,
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error('Empty response from OpenAI');

  return JSON.parse(text);
}

export async function extractMetadata(
  rawText: string,
): Promise<{ metadata: MemoryMetadata; status: MetadataStatus }> {
  try {
    const { prompt, truncated } = buildPrompt(rawText);
    const provider = process.env.METADATA_LLM_PROVIDER || 'anthropic';

    const raw = provider === 'openai'
      ? await extractWithOpenAI(prompt)
      : await extractWithAnthropic(prompt);

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
