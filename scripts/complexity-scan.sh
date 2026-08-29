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

# Parse args with a shift loop so both `--top=N` and the documented
# `--top N` (space-separated) forms work; the value is consumed as TOP so it is
# never treated as a stray separate argument.
while [ $# -gt 0 ]; do
  case "$1" in
    --json) MODE="json" ;;
    --top=*) TOP="${1#--top=}" ;;
    --top) shift; TOP="${1:-}" ;;
    --path=*) SCAN_PATH="${1#--path=}" ;;
    --report) REPORT=true ;;
    *) ;;
  esac
  shift
done

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun not found in PATH" >&2
  exit 2
fi

# Capture the oxlint exit status instead of discarding it: a non-zero status
# means oxlint itself failed (e.g. bad config / missing files), which must not
# be silently reported as a clean scan.
set +e
RAW="$(bun x oxlint --config .oxlintrc.json "$SCAN_PATH" 2>&1)"
OXLINT_RC=$?
set -e

TMP_FILE="$(mktemp -t complexity-XXXXXX)"
trap 'rm -f "$TMP_FILE"' EXIT
printf '%s' "$RAW" > "$TMP_FILE"

MODE_ENV="$MODE" TOP_ENV="${TOP:-}" PYTHONIOENCODING=utf-8 python3 "$ROOT/scripts/_parse-complexity.py" "$TMP_FILE"

# Non-blocking modes (--report) only print the report.
if [ "$REPORT" = "true" ]; then
  exit 0
fi

# Gate mode: an oxlint execution failure must fail the gate even when no
# complexity diagnostic is present; otherwise a broken scan is masked as clean.
if [ "$OXLINT_RC" -ne 0 ]; then
  echo "error: oxlint failed (exit $OXLINT_RC); scan did not complete" >&2
  exit "$OXLINT_RC"
fi
# Gate on $RAW via a here-string (NOT `printf | grep -q`): under pipefail,
# `grep -q` can exit early on a match and SIGPIPE the writer, making the
# pipeline fail spuriously and letting real complexity violations pass CI.
if grep -q "complexity" <<< "$RAW"; then
  exit 1
fi
exit 0
