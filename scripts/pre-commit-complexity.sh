#!/bin/bash
# Pre-commit hook: warn about high cyclomatic complexity via oxlint.
# Non-blocking — warnings only, does not prevent commits.
#
# Install (from the repo root):
#   cp scripts/pre-commit-complexity.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit

STAGED_TS=$(git diff --cached --name-only --diff-filter=ACM -- '*.ts' | grep -v node_modules | grep -v __tests__ | grep -vE '\.(test|spec)\.ts$' || true)

if [ -z "$STAGED_TS" ]; then
  exit 0
fi

echo "🔍 Checking cyclomatic complexity..."

ISSUES=$(printf '%s\n' "$STAGED_TS" | xargs -r bun x oxlint --config .oxlintrc.json 2>&1 | grep -i "complexity" || true)

if [ -n "$ISSUES" ]; then
  echo ""
  echo "⚠️  Complexity warnings (non-blocking):"
  echo "$ISSUES"
  echo ""
  echo "Consider refactoring high-complexity functions for readability."
  echo "These are warnings only — your commit will proceed."
else
  echo "✅ No complexity issues found."
fi

exit 0
