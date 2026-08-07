#!/usr/bin/env bash
# Prepare a synthetic review-only PR whose diff is the entire codebase,
# so CodeRabbit (or Greptile) reviews the whole repo, not just a feature diff.
#
# Usage:
#   scripts/fullcode-review.sh                 # one PR for the whole tree
#   scripts/fullcode-review.sh <chunk-name> <path...>   # one PR for a chunk
#   scripts/fullcode-review.sh core src/ scripts/ test-app.ts
#
# Examples (mirrors PRs #73-#94):
#   scripts/fullcode-review.sh
#   scripts/fullcode-review.sh scripts scripts/
#   scripts/fullcode-review.sh data data/ _data/ _original_source/
#
# Notes:
#   - Creates/updates the "empty-base" branch: master's history, empty tree.
#   - Creates a branch that re-adds the requested paths, then opens a PR.
#   - Never touches master; the PR is synthetic and safe to close.
set -euo pipefail

CHUNK="${1:-full}"
shift || true

git fetch origin master --quiet

BASE_SHA=$(git rev-parse origin/master)

# The empty-base commit: same parent as master but with an empty tree.
EMPTY_TREE=4b825dc642cb6eb9a060e54bf8d69288fbee4904
EMPTY_SHA=$(git commit-tree "$EMPTY_TREE" -p "$BASE_SHA" -m "empty-base: empty tree for full-codebase review diff")
git branch -f empty-base "$EMPTY_SHA"
git push -f origin empty-base --quiet
echo "empty-base updated to $EMPTY_SHA"

# Build a fresh branch from empty-base and re-add the requested paths.
BRANCH="full-review-${CHUNK}"
git checkout -B "$BRANCH" "$EMPTY_SHA"

if [ -n "$2" ]; then
  # Chunked review: restore only the listed paths from master.
  # shellcheck disable=SC2086
  git checkout origin/master -- "$@"
  git add "$@"
else
  # Full review: restore the entire tree.
  git checkout origin/master -- .
  git add -A
fi

git -c user.name="4-mat" -c user.email="4-mat@users.noreply.github.com" \
  commit -m "review: ${CHUNK} (full-codebase chunk)" --quiet
git push -u origin "$BRANCH" --quiet

TITLE="review: ${CHUNK} (full-codebase chunk)"
gh pr create --base empty-base --head "$BRANCH" \
  --title "$TITLE" \
  --body "Synthetic review-only PR — **DO NOT MERGE**.

The diff is the entire codebase: the base branch \`empty-base\` is master's history with an empty tree, and \`$BRANCH\` re-adds the full tree.

Purpose: get CodeRabbit to review the whole repository instead of just a feature diff. No real code changes — safe to close."

echo "PR created: $TITLE"
