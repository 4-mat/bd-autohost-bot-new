#!/bin/bash
# complexity-scan.sh — scan the repo for functions over the cyclomatic complexity threshold.
#
# Usage:
#   ./scripts/complexity-scan.sh              # scan src/, sort by complexity desc
#   ./scripts/complexity-scan.sh --json       # machine-readable output
#   ./scripts/complexity-scan.sh --top N      # only the N worst offenders
#   ./scripts/complexity-scan.sh --path=X     # scan a different path
#
# Exits 1 when any function exceeds the threshold (so CI can gate on it),
# 0 otherwise. Pass --report to always exit 0 (local usage).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="text"
TOP=""
SCAN_PATH="src/"
REPORT=false

for arg in "$@"; do
  case "$arg" in
    --json) MODE="json" ;;
    --top=*) TOP="${arg#--top=}" ;;
    --path=*) SCAN_PATH="${arg#--path=}" ;;
    --report) REPORT=true ;;
    *) ;;
  esac
done

# Run oxlint, capture raw output.
RAW="$(bun x oxlint --config .oxlintrc.json "$SCAN_PATH" 2>&1 || true)"

# Pass raw output to the parser via a temp file (heredoc + stdin don't
# mix well on Windows).
TMP_FILE="$(mktemp)"
printf '%s' "$RAW" > "$TMP_FILE"

MODE_ENV="$MODE" TOP_ENV="${TOP:-}" PYTHONIOENCODING=utf-8 python3 "$ROOT/scripts/_parse-complexity.py" "$TMP_FILE"

rm -f "$TMP_FILE"

# Gate mode: fail when any function exceeds the threshold.
if [ "$REPORT" != "true" ] && printf '%s' "$RAW" | grep -q "complexity"; then
  exit 1
fi
exit 0
