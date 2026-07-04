import type { EmbeddingStatus, MemoryMetadata, MemorySource, MetadataStatus } from 'open-brain-workers-shared';

// workers/shared's MemoryMetadata has no sentiment field (it's optional
// LLM output, not part of the storage contract); extend it locally so
// validated metadata can still carry sentiment through, matching
// mcp-server's MemoryMetadata shape.
export interface CaptureMetadata extends MemoryMetadata {
  sentiment?: 'positive' | 'neutral' | 'negative' | 'mixed';
}

export const VALID_METADATA_TYPES = [
  'decision', 'insight', 'person_note', 'meeting_debrief', 'task', 'reference', 'unknown',
] as const;

export const DEGRADED_METADATA: CaptureMetadata = {
  type: 'unknown',
  topics: [],
  people: [],
  action_items: [],
  confidence: 0.0,
  truncated: false,
};

export interface SearchResult {
  id: string;
  raw_text: string;
  captured_at: string;
  source: MemorySource;
  metadata: MemoryMetadata;
  metadata_status: MetadataStatus;
  embedding_status: EmbeddingStatus;
  similarity_score: number;
}

export interface RecentMemory {
  id: string;
  raw_text: string;
  metadata: MemoryMetadata;
  metadata_status: MetadataStatus;
  captured_at: string;
  source: MemorySource;
}

export interface StatsResponse {
  total_memories: number;
  last_7_days: number;
  last_30_days: number;
  by_type: Record<string, number>;
  by_embedding_status: Record<EmbeddingStatus, number>;
  embedding_model: string;
  top_topics: Array<{ topic: string; count: number }>;
}

export interface SystemConfig {
  id: number;
  embedding_model: string;
  embedding_dimensions: number;
  created_at: string;
  updated_at: string;
}

export interface TokenResponse {
  token: string;
  expires_in: number;
  token_type: 'Bearer';
}
