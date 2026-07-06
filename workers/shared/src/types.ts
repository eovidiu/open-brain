export type EmbeddingStatus = 'ready' | 'pending' | 'failed';
export type MetadataStatus = 'ready' | 'degraded' | 'failed';
export type MemorySource = 'slack' | 'claude' | 'chatgpt' | 'mcp_direct' | 'api';

export interface MemoryMetadata {
  type: string;
  topics: string[];
  people: string[];
  action_items: string[];
  confidence: number;
  truncated: boolean;
}

export interface InsertMemoryRecord {
  id: string;
  raw_text: string;
  embedding: number[] | null;
  embedding_status: EmbeddingStatus;
  metadata: MemoryMetadata;
  metadata_status: 'ready' | 'degraded';
  captured_at: string;
  source: MemorySource;
}

export interface CaptureResult {
  id: string;
  captured_at: string;
  source: MemorySource;
  embedding_status: EmbeddingStatus;
  metadata_status: 'ready' | 'degraded';
  metadata: MemoryMetadata;
}

export interface RetryEligibleMemory {
  id: string;
  embedding_status: EmbeddingStatus;
  metadata_status: MetadataStatus;
  retry_count_embedding: number;
  retry_count_metadata: number;
  captured_at: string;
  raw_text: string;
}

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
