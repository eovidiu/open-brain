#!/usr/bin/env bash
# Applies db/migrations/*.sql to $DATABASE_URL in filename order, once each.
# Tracking table: schema_migrations. Re-running is a no-op (exit 0).
# Each migration and its tracking record commit in a single transaction.
#
# Usage: DATABASE_URL=postgres://... scripts/migrate.sh
set -euo pipefail
shopt -s nullglob

if [ -z "${DATABASE_URL:-}" ]; then
  echo "error: DATABASE_URL is required" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$SCRIPT_DIR/../db/migrations}"

psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c \
  "CREATE TABLE IF NOT EXISTS schema_migrations (
     filename   text PRIMARY KEY,
     applied_at timestamptz NOT NULL DEFAULT now()
   )"

applied=0
skipped=0
for file in "$MIGRATIONS_DIR"/*.sql; do
  name="$(basename "$file")"
  already="$(psql "$DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c \
    "SELECT count(*) FROM schema_migrations WHERE filename = '${name}'")"
  if [ "$already" = "1" ]; then
    skipped=$((skipped + 1))
    continue
  fi
  echo "applying ${name}"
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 --single-transaction \
    -f "$file" \
    -c "INSERT INTO schema_migrations (filename) VALUES ('${name}')"
  applied=$((applied + 1))
done

echo "migrations: ${applied} applied, ${skipped} already applied"
