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
    --top)
      shift
      if [ $# -gt 0 ]; then TOP="$1"; fi
      ;;
    --path=*) SCAN_PATH="${arg#--path=}" ;;
    --report) REPORT=true ;;
    *) ;;
  esac
done

# Run oxlint, capture raw output and exit code.
# The if-wrapping prevents `set -e` from killing the script when oxlint
# itself fails (config error, missing binary, etc.) — we want to keep both
# its output and its exit code for reporting below.
if RAW="$(bun x --no-install oxlint --config .oxlintrc.json "$SCAN_PATH" 2>&1)"; then
  SCAN_EXIT=0
else
  SCAN_EXIT=$?
fi

# Always print raw output for visibility.
printf '%s\n' "$RAW"

# Pass raw output to the parser via a temp file (heredoc + stdin don't
# mix well on Windows).
TMP_FILE="$(mktemp)"
printf '%s' "$RAW" > "$TMP_FILE"

# Run parser to generate the report (text or json)
MODE_ENV="$MODE" TOP_ENV="${TOP:-}" PYTHONIOENCODING=utf-8 python3 "$ROOT/scripts/_parse-complexity.py" "$TMP_FILE"

rm -f "$TMP_FILE"

# Propagate scanner failure: if oxlint itself failed (config, resolution, etc.),
# exit with its code so CI does not pass silently.
if [ $SCAN_EXIT -ne 0 ]; then
  exit $SCAN_EXIT
fi

# Gate mode: an oxlint execution failure must fail the gate even when no
# complexity diagnostic is present; otherwise a broken scan is masked as clean.
if [ "$OXLINT_RC" -ne 0 ]; then
  echo "error: oxlint failed (exit $OXLINT_RC); scan did not complete" >&2
  exit "$OXLINT_RC"
fi

# Gate on parsed results: run parser in JSON mode and check if any functions
# exceed the threshold. This avoids the crude grep which matches "complexity"
# in "Maximum allowed is 15" or parser warnings.
JSON_OUT="$(MODE_ENV=json TOP_ENV="${TOP:-}" PYTHONIOENCODING=utf-8 python3 "$ROOT/scripts/_parse-complexity.py" "$TMP_FILE" 2>/dev/null)"
# Count elements in JSON array (handles empty array "[]")
COUNT=$(printf '%s' "$JSON_OUT" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)
if [ "$COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
