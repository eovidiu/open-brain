import { getSupabaseClient } from './client.js';
import type {
  CaptureResponse,
  EmbeddingStatus,
  Memory,
  MemoryMetadata,
  MemorySource,
  SearchResult,
  StatsResponse,
  SystemConfig,
} from '../types.js';

const MAX_EMBEDDING_RETRIES = 10;
const MAX_METADATA_RETRIES = 10;

function sanitizeDbError(context: string, error: { message: string }): Error {
  console.error(`[db] ${context}: ${error.message}`);
  return new Error(`Database operation failed: ${context}`);
}

// Insert a new memory record and return a CaptureResponse
export async function insertMemory(record: {
  id: string;
  raw_text: string;
  embedding: number[] | null;
  embedding_status: EmbeddingStatus;
  metadata: MemoryMetadata;
  metadata_status: 'ready' | 'degraded';
  captured_at: string;
  source: MemorySource;
}): Promise<CaptureResponse> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('memories')
    .insert({
      id: record.id,
      raw_text: record.raw_text,
      embedding: record.embedding,
      embedding_status: record.embedding_status,
      metadata: record.metadata,
      metadata_status: record.metadata_status,
      captured_at: record.captured_at,
      source: record.source,
      retry_count_embedding: 0,
      retry_count_metadata: 0,
      last_processing_error: null,
    })
    .select('id, captured_at, source, embedding_status, metadata_status, metadata')
    .single();

  if (error) {
    throw sanitizeDbError('insert memory', error);
  }

  return {
    id: data.id,
    captured_at: data.captured_at,
    source: data.source as MemorySource,
    embedding_status: data.embedding_status as EmbeddingStatus,
    metadata_status: data.metadata_status as 'ready' | 'degraded',
    metadata: data.metadata as MemoryMetadata,
  };
}

// Vector similarity search using pgvector via RPC
export async function searchMemories(
  queryVector: number[],
  n: number,
  filterType?: string,
  since?: string,
): Promise<SearchResult[]> {
  const supabase = getSupabaseClient();

  const params: Record<string, unknown> = {
    query_embedding: queryVector,
    match_count: n,
  };

  if (filterType) {
    params.filter_type = filterType;
  }
  if (since) {
    params.filter_since = since;
  }

  const { data, error } = await supabase.rpc('search_memories', params);

  if (error) {
    throw sanitizeDbError('search memories', error);
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    raw_text: row.raw_text as string,
    captured_at: row.captured_at as string,
    source: row.source as MemorySource,
    metadata: row.metadata as MemoryMetadata,
    metadata_status: row.metadata_status as 'ready' | 'degraded',
    embedding_status: row.embedding_status as EmbeddingStatus,
    similarity_score: row.similarity_score as number,
  }));
}

// List recent memories ordered by captured_at DESC
export async function listRecentMemories(
  n: number,
  filterType?: string,
): Promise<Memory[]> {
  const supabase = getSupabaseClient();

  let query = supabase
    .from('memories')
    .select('*')
    .order('captured_at', { ascending: false })
    .limit(n);

  if (filterType) {
    query = query.eq('metadata->>type', filterType);
  }

  const { data, error } = await query;

  if (error) {
    throw sanitizeDbError('list memories', error);
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    raw_text: row.raw_text as string,
    embedding: row.embedding as number[] | null,
    embedding_status: row.embedding_status as EmbeddingStatus,
    metadata: row.metadata as MemoryMetadata,
    metadata_status: row.metadata_status as 'ready' | 'degraded',
    captured_at: row.captured_at as string,
    source: row.source as MemorySource,
    retry_count_embedding: row.retry_count_embedding as number,
    retry_count_metadata: row.retry_count_metadata as number,
    last_processing_error: row.last_processing_error as string | null,
  }));
}

// Aggregate stats query
export async function getStats(): Promise<StatsResponse> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.rpc('get_memory_stats');

  if (error) {
    throw sanitizeDbError('get stats', error);
  }

  const raw = data as Record<string, unknown>;

  return {
    total_memories: raw.total_memories as number,
    last_7_days: raw.last_7_days as number,
    last_30_days: raw.last_30_days as number,
    by_type: raw.by_type as Record<string, number>,
    by_embedding_status: raw.by_embedding_status as Record<EmbeddingStatus, number>,
    embedding_model: raw.embedding_model as string,
    top_topics: raw.top_topics as Array<{ topic: string; count: number }>,
  };
}

// Read system_config singleton
export async function getSystemConfig(): Promise<SystemConfig> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('system_config')
    .select('*')
    .limit(1)
    .single();

  if (error) {
    throw sanitizeDbError('read system config', error);
  }

  return {
    id: data.id as number,
    embedding_model: data.embedding_model as string,
    embedding_dimensions: data.embedding_dimensions as number,
    created_at: data.created_at as string,
    updated_at: data.updated_at as string,
  };
}

// Set embedding and mark status as ready
export async function updateMemoryEmbedding(
  id: string,
  embedding: number[],
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('memories')
    .update({
      embedding,
      embedding_status: 'ready' as EmbeddingStatus,
      last_processing_error: null,
    })
    .eq('id', id);

  if (error) {
    throw sanitizeDbError('update embedding', error);
  }
}

// Set metadata and mark status as ready
export async function updateMemoryMetadata(
  id: string,
  metadata: MemoryMetadata,
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('memories')
    .update({
      metadata,
      metadata_status: 'ready' as const,
      last_processing_error: null,
    })
    .eq('id', id);

  if (error) {
    throw sanitizeDbError('update metadata', error);
  }
}

// Increment embedding retry count, set error, mark failed if terminal
export async function incrementEmbeddingRetry(
  id: string,
  processingError: string,
): Promise<void> {
  const supabase = getSupabaseClient();

  // Read current retry count
  const { data: current, error: readError } = await supabase
    .from('memories')
    .select('retry_count_embedding')
    .eq('id', id)
    .single();

  if (readError) {
    throw sanitizeDbError('read embedding retry count', readError);
  }

  const newCount = (current.retry_count_embedding as number) + 1;
  const isFailed = newCount >= MAX_EMBEDDING_RETRIES;

  const { error: updateError } = await supabase
    .from('memories')
    .update({
      retry_count_embedding: newCount,
      last_processing_error: processingError,
      ...(isFailed ? { embedding_status: 'failed' as EmbeddingStatus } : {}),
    })
    .eq('id', id);

  if (updateError) {
    throw sanitizeDbError('increment embedding retry', updateError);
  }
}

// Increment metadata retry count, set error, mark failed if terminal
export async function incrementMetadataRetry(
  id: string,
  processingError: string,
): Promise<void> {
  const supabase = getSupabaseClient();

  // Read current retry count
  const { data: current, error: readError } = await supabase
    .from('memories')
    .select('retry_count_metadata')
    .eq('id', id)
    .single();

  if (readError) {
    throw sanitizeDbError('read metadata retry count', readError);
  }

  const newCount = (current.retry_count_metadata as number) + 1;
  const isFailed = newCount >= MAX_METADATA_RETRIES;

  const { error: updateError } = await supabase
    .from('memories')
    .update({
      retry_count_metadata: newCount,
      last_processing_error: processingError,
      ...(isFailed ? { metadata_status: 'failed' } : {}),
    })
    .eq('id', id);

  if (updateError) {
    throw sanitizeDbError('increment metadata retry', updateError);
  }
}
