#!/bin/bash
# Harness init.sh - build/test runner for open-brain
# Usage: .harness/init.sh [smoke_test|full_test]
# Default: full_test
#
# smoke_test — TypeScript compile check on both workspaces (<15s).
#              Used by the TaskCompleted hook as a first-pass gate.
# full_test  — compile check + Vitest suite (mcp-server workspace).
#              Used by the lead's synthesis step and session-end validation.
#
# Stack: Node.js ESM, npm workspaces (mcp-server, cli), Vitest.

set -eo pipefail

TARGET=${1:-full_test}

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== Harness ${TARGET} ==="
echo "Project: $PROJECT_ROOT"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

if [ ! -d node_modules ]; then
    echo "--- Installing dependencies (npm ci) ---"
    npm ci 2>&1 | tail -5
    echo ""
fi

echo "--- TypeScript check: mcp-server ---"
npx tsc --noEmit -p mcp-server 2>&1 | tail -10

echo "--- TypeScript check: cli ---"
npx tsc --noEmit -p cli 2>&1 | tail -10

if [ "$TARGET" = "full_test" ]; then
    echo ""
    echo "--- Tests: mcp-server (vitest) ---"
    npm test --workspace=mcp-server 2>&1 | tail -25
fi

echo ""
echo "=== ${TARGET} Complete ==="
