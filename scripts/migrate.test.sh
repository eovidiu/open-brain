#!/usr/bin/env bash
# Behavioral test for migrate.sh and assert-schema.sh.
#
# Requires a reachable Postgres with the pgvector extension available and
# permission to create/drop databases. Defaults to the local test container:
#   docker run -d --name openbrain-test-pg -e POSTGRES_PASSWORD=test \
#     -e POSTGRES_DB=openbrain_test -p 54329:5432 pgvector/pgvector:pg17
#
# Usage: TEST_ADMIN_URL=postgres://... scripts/migrate.test.sh
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_ADMIN_URL="${TEST_ADMIN_URL:-postgres://postgres:test@localhost:54329/postgres}"
TEST_DB="openbrain_migrate_test"
TEST_DB_URL="${TEST_ADMIN_URL%/*}/${TEST_DB}"

PASS=0
FAIL=0

check() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS + 1))
    echo "ok: ${desc}"
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: ${desc} (expected '${expected}', got '${actual}')"
  fi
}

fresh_db() {
  psql "$TEST_ADMIN_URL" -q -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS ${TEST_DB}" \
    -c "CREATE DATABASE ${TEST_DB}"
}

fresh_db

# 1. First run applies all migrations and exits 0
out="$(DATABASE_URL="$TEST_DB_URL" "$SCRIPT_DIR/migrate.sh" 2>&1)"
check "first run exits 0" 0 $?
applied="$(psql "$TEST_DB_URL" -tA -c "SELECT count(*) FROM schema_migrations")"
expected_count="$(ls "$SCRIPT_DIR/../db/migrations/"*.sql | wc -l | tr -d ' ')"
check "all migrations recorded" "$expected_count" "$applied"

# 2. Second run is a no-op and exits 0
out="$(DATABASE_URL="$TEST_DB_URL" "$SCRIPT_DIR/migrate.sh" 2>&1)"
check "second run exits 0" 0 $?
echo "$out" | grep -q "0 applied"
check "second run reports no-op" 0 $?

# 3. Schema assertion passes on the migrated database
DATABASE_URL="$TEST_DB_URL" "$SCRIPT_DIR/assert-schema.sh" >/dev/null 2>&1
check "assert-schema passes on migrated db" 0 $?

# 4. Expected objects actually exist (independent of assert-schema)
col="$(psql "$TEST_DB_URL" -tA -c \
  "SELECT format_type(atttypid, atttypmod) FROM pg_attribute
   WHERE attrelid = 'memories'::regclass AND attname = 'embedding'")"
check "embedding column is vector(1536)" "vector(1536)" "$col"

hnsw="$(psql "$TEST_DB_URL" -tA -c \
  "SELECT count(*) FROM pg_indexes
   WHERE tablename = 'memories' AND indexdef LIKE '%hnsw%'")"
check "HNSW index present" 1 "$hnsw"

funcs="$(psql "$TEST_DB_URL" -tA -c \
  "SELECT count(*) FROM pg_proc WHERE proname IN
   ('search_memories', 'get_memory_stats', 'get_retry_eligible_memories')")"
check "three SQL functions present" 3 "$funcs"

seed="$(psql "$TEST_DB_URL" -tA -c \
  "SELECT embedding_model FROM system_config WHERE id = 1")"
check "system_config seeded" "text-embedding-3-small" "$seed"

# 5. Dropped constructs are absent
cron="$(psql "$TEST_DB_URL" -tA -c \
  "SELECT count(*) FROM pg_extension WHERE extname = 'pg_cron'")"
check "no pg_cron extension" 0 "$cron"

rls="$(psql "$TEST_DB_URL" -tA -c \
  "SELECT count(*) FROM pg_class
   WHERE relname IN ('memories', 'system_config') AND relrowsecurity")"
check "no RLS enabled" 0 "$rls"

policies="$(psql "$TEST_DB_URL" -tA -c "SELECT count(*) FROM pg_policies")"
check "no policies" 0 "$policies"

grants="$(psql "$TEST_DB_URL" -tA -c \
  "SELECT count(*) FROM information_schema.role_table_grants
   WHERE grantee IN ('anon', 'authenticated')")"
check "no anon/authenticated grants" 0 "$grants"

legacy_fn="$(psql "$TEST_DB_URL" -tA -c \
  "SELECT count(*) FROM pg_proc WHERE proname = 'process_pending_memories'")"
check "process_pending_memories not ported" 0 "$legacy_fn"

# 6. assert-schema fails on a database missing the schema
psql "$TEST_ADMIN_URL" -q -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS ${TEST_DB}_empty" \
  -c "CREATE DATABASE ${TEST_DB}_empty"
DATABASE_URL="${TEST_ADMIN_URL%/*}/${TEST_DB}_empty" \
  "$SCRIPT_DIR/assert-schema.sh" >/dev/null 2>&1
rc=$?
check "assert-schema fails on empty db" 1 "$([ "$rc" -ne 0 ] && echo 1 || echo 0)"
psql "$TEST_ADMIN_URL" -q -c "DROP DATABASE IF EXISTS ${TEST_DB}_empty"

# 7. Runner fails loudly without DATABASE_URL
env -u DATABASE_URL "$SCRIPT_DIR/migrate.sh" >/dev/null 2>&1
rc=$?
check "migrate.sh fails without DATABASE_URL" 1 "$([ "$rc" -ne 0 ] && echo 1 || echo 0)"

psql "$TEST_ADMIN_URL" -q -c "DROP DATABASE IF EXISTS ${TEST_DB}"

echo
echo "${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
