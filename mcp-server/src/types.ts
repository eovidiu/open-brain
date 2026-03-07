// Memory metadata schema
export interface MemoryMetadata {
  type: 'decision' | 'insight' | 'person_note' | 'meeting_debrief' | 'task' | 'reference' | 'unknown';
  topics: string[];
  people: string[];
  action_items: string[];
  sentiment?: 'positive' | 'neutral' | 'negative' | 'mixed';
  confidence: number;
  truncated: boolean;
}

// Source enum
export type MemorySource = 'slack' | 'claude' | 'chatgpt' | 'mcp_direct' | 'api';

// Embedding status
export type EmbeddingStatus = 'ready' | 'pending' | 'failed';

// Metadata status
export type MetadataStatus = 'ready' | 'degraded';

// Full memory record from DB
export interface Memory {
  id: string;
  raw_text: string;
  embedding: number[] | null;
  embedding_status: EmbeddingStatus;
  metadata: MemoryMetadata;
  metadata_status: MetadataStatus;
  captured_at: string;
  source: MemorySource;
  retry_count_embedding: number;
  retry_count_metadata: number;
  last_processing_error: string | null;
}

// Capture request
export interface CaptureRequest {
  text: string;
  source?: MemorySource;
}

// Capture response
export interface CaptureResponse {
  id: string;
  captured_at: string;
  source: MemorySource;
  embedding_status: EmbeddingStatus;
  metadata_status: MetadataStatus;
  metadata: MemoryMetadata;
}

// Search result
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

// Stats response
export interface StatsResponse {
  total_memories: number;
  last_7_days: number;
  last_30_days: number;
  by_type: Record<string, number>;
  by_embedding_status: Record<EmbeddingStatus, number>;
  embedding_model: string;
  top_topics: Array<{ topic: string; count: number }>;
}

// System config
export interface SystemConfig {
  id: number;
  embedding_model: string;
  embedding_dimensions: number;
  created_at: string;
  updated_at: string;
}

// Degraded metadata default
export const DEGRADED_METADATA: MemoryMetadata = {
  type: 'unknown',
  topics: [],
  people: [],
  action_items: [],
  confidence: 0.0,
  truncated: false,
};

// Error codes
export type CaptureErrorCode = 'INVALID_TEXT' | 'INVALID_SOURCE' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'DB_WRITE_FAILED';

// Auth token response
export interface TokenResponse {
  token: string;
  expires_in: number;
  token_type: 'Bearer';
}

// Health response
export interface HealthResponse {
  status: 'ok' | 'degraded';
  db_connected: boolean;
  total_memories?: number;
  embedding_model?: string;
}

// Valid source values for validation
export const VALID_SOURCES: MemorySource[] = ['slack', 'claude', 'chatgpt', 'mcp_direct', 'api'];
export const VALID_METADATA_TYPES = ['decision', 'insight', 'person_note', 'meeting_debrief', 'task', 'reference', 'unknown'] as const;
