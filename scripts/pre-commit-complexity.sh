#!/bin/bash
# Pre-commit hook: warn about high cyclomatic complexity via oxlint.
# Non-blocking — warnings only, does not prevent commits.
#
# Install (from the repo root):
#   cp scripts/pre-commit-complexity.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit

STAGED_TS=$(git diff --cached --name-only --diff-filter=ACM -- '*.ts' | grep -v node_modules | grep -v __tests__)

if [ -z "$STAGED_TS" ]; then
  exit 0
fi

echo "🔍 Checking cyclomatic complexity..."

# Run oxlint with complexity warn on staged .ts files, capturing output and
# exit status separately. oxlint exits 0 when it only prints warnings; a
# non-zero status means oxlint itself failed (bad config / missing files).
RAW=$(printf '%s\n' "$STAGED_TS" | xargs -r bun x --no-install oxlint --config .oxlintrc.json 2>&1)
SCAN_EXIT=$?

# If oxlint itself failed (config, resolution, etc.), report the failure
# but exit 0 — this hook is warning-only and must never block a commit.
if [ "$SCAN_EXIT" -ne 0 ]; then
  echo ""
  echo "❌ oxlint scan failed (exit code $SCAN_EXIT):"
  echo "$RAW"
  echo ""
  exit 0
fi

# Report only real over-threshold functions by running the same parser the
# CI gate uses (_parse-complexity.py) instead of a crude grep on the raw
# output, which would also match the literal "Maximum allowed is 15" text in
# every warning line.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT
printf '%s' "$RAW" > "$TMP_FILE"

REPORT="$(PYTHONIOENCODING=utf-8 python3 "$ROOT/scripts/_parse-complexity.py" "$TMP_FILE" 2>&1)"
PARSER_RC=$?

# Non-blocking: a parser failure warns and skips, but never blocks a commit.
if [ "$PARSER_RC" -ne 0 ]; then
  echo ""
  echo "⚠️  Complexity parser failed (exit $PARSER_RC); skipping warnings (non-blocking)."
  echo "$REPORT"
  exit 0
fi

COUNT="$(MODE_ENV=json PYTHONIOENCODING=utf-8 python3 "$ROOT/scripts/_parse-complexity.py" "$TMP_FILE" 2>/dev/null | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)"

if [ "$COUNT" -gt 0 ]; then
  echo ""
  echo "⚠️  Complexity warnings (non-blocking):"
  echo "$REPORT"
  echo ""
  echo "Consider refactoring high-complexity functions for readability."
  echo "These are warnings only — your commit will proceed."
else
  echo "✅ No complexity issues found."
fi

exit 0
