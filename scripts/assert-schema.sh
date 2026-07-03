#!/usr/bin/env bash
# Asserts the migrated schema on $DATABASE_URL: expected objects present,
# no pg_cron, no RLS/policies, no anon/authenticated grants.
# Exits 0 when all checks pass, 1 otherwise.
#
# Usage: DATABASE_URL=postgres://... scripts/assert-schema.sh
set -u

if [ -z "${DATABASE_URL:-}" ]; then
  echo "error: DATABASE_URL is required" >&2
  exit 1
fi

ERRORS=0

q() {
  psql "$DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "$1" 2>/dev/null
}

expect() {
  local desc="$1" expected="$2" sql="$3"
  local actual
  actual="$(q "$sql")"
  if [ "$actual" = "$expected" ]; then
    echo "ok: ${desc}"
  else
    ERRORS=$((ERRORS + 1))
    echo "FAIL: ${desc} (expected '${expected}', got '${actual}')" >&2
  fi
}

# Expected objects
expect "vector extension" 1 \
  "SELECT count(*) FROM pg_extension WHERE extname = 'vector'"
expect "memories table" memories \
  "SELECT to_regclass('public.memories')"
expect "system_config table" system_config \
  "SELECT to_regclass('public.system_config')"
expect "embedding column vector(1536)" "vector(1536)" \
  "SELECT format_type(atttypid, atttypmod) FROM pg_attribute
   WHERE attrelid = to_regclass('public.memories') AND attname = 'embedding'"
expect "HNSW index" 1 \
  "SELECT count(*) FROM pg_indexes
   WHERE tablename = 'memories' AND indexdef LIKE '%hnsw%'"
expect "captured_at index" 1 \
  "SELECT count(*) FROM pg_indexes
   WHERE indexname = 'memories_captured_at_desc_idx'"
expect "embedding_status index" 1 \
  "SELECT count(*) FROM pg_indexes
   WHERE indexname = 'memories_embedding_status_idx'"
expect "search_memories function" 1 \
  "SELECT count(*) FROM pg_proc WHERE proname = 'search_memories'"
expect "get_memory_stats function" 1 \
  "SELECT count(*) FROM pg_proc WHERE proname = 'get_memory_stats'"
expect "get_retry_eligible_memories function" 1 \
  "SELECT count(*) FROM pg_proc WHERE proname = 'get_retry_eligible_memories'"
expect "system_config seeded" "text-embedding-3-small" \
  "SELECT embedding_model FROM system_config WHERE id = 1"

# Dropped Supabase constructs must be absent
expect "no pg_cron extension" 0 \
  "SELECT count(*) FROM pg_extension WHERE extname = 'pg_cron'"
expect "no RLS on tables" 0 \
  "SELECT count(*) FROM pg_class
   WHERE relname IN ('memories', 'system_config') AND relrowsecurity"
expect "no policies" 0 \
  "SELECT count(*) FROM pg_policies"
expect "no anon/authenticated grants" 0 \
  "SELECT count(*) FROM information_schema.role_table_grants
   WHERE grantee IN ('anon', 'authenticated')"
expect "no process_pending_memories function" 0 \
  "SELECT count(*) FROM pg_proc WHERE proname = 'process_pending_memories'"

echo
if [ "$ERRORS" -gt 0 ]; then
  echo "schema assertion FAILED: ${ERRORS} check(s)" >&2
  exit 1
fi
echo "schema OK"
