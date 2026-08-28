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

# Run oxlint on staged TS files, capturing output and exit status separately.
# oxlint exits 0 when it only prints warnings; a non-zero status means oxlint
# itself failed (bad config / missing files) and must be reported on its own.
OXLINT_OUT=$(printf '%s\n' "$STAGED_TS" | xargs -r bun x oxlint --config .oxlintrc.json 2>&1)
OXLINT_RC=$?

ISSUES=$(printf '%s\n' "$OXLINT_OUT" | grep -i "complexity" || true)

if [ -n "$ISSUES" ]; then
  echo ""
  echo "⚠️  Complexity warnings (non-blocking):"
  echo "$ISSUES"
  echo ""
  echo "Consider refactoring high-complexity functions for readability."
  echo "These are warnings only — your commit will proceed."
fi

# Report oxlint execution errors separately from the filtered complexity
# warnings (still non-blocking — this is a pre-commit warning hook).
if [ "$OXLINT_RC" -ne 0 ]; then
  ERRORS=$(printf '%s\n' "$OXLINT_OUT" | grep -vi "complexity" || true)
  echo ""
  if [ -n "$ERRORS" ]; then
    echo "⚠️  oxlint failed (exit $OXLINT_RC); execution error (non-blocking):"
    echo "$ERRORS"
  else
    echo "⚠️  oxlint failed (exit $OXLINT_RC); non-blocking."
  fi
fi

if [ -z "$ISSUES" ] && [ "$OXLINT_RC" -eq 0 ]; then
  echo "✅ No complexity issues found."
fi

exit 0
