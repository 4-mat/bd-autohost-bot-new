#!/usr/bin/env bash
# Tag open PRs that have merge conflicts with the "merge conflict" label.
#
# Local twin of .github/workflows/conflict-label.yml (PR #223). Uses the same
# deterministic check - `git merge-tree --write-tree` (exit 1 = conflict,
# 0 = clean, anything else = error/skip) - instead of GitHub's lazily-computed
# "mergeable" field, which can sit at UNKNOWN.
#
# Usage:
#   scripts/tag-conflicting-prs.sh            # check ALL open PRs
#   scripts/tag-conflicting-prs.sh 223 224    # check only these PRs
set -euo pipefail

LABEL="merge conflict"
PRS_ARG="${*:-}"

cd "$(git rev-parse --show-toplevel)"

echo "==> Fetching PR heads + base branches"
git fetch origin "+refs/pull/*/head:refs/remotes/origin/pr/*" --quiet
git fetch origin "+refs/heads/*:refs/remotes/origin/*" --quiet

if [ -n "$PRS_ARG" ]; then
  PRS=""
  for N in $PRS_ARG; do
    BASE=$(gh pr view "$N" --json baseRefName --jq .baseRefName 2>/dev/null || echo "")
    [ -n "$BASE" ] && PRS="$PRS
$N $BASE"
  done
else
  PRS=$(gh pr list --state open --limit 100 --json number,baseRefName --jq '.[] | "\(.number) \(.baseRefName)"')
fi

# Ensure the label exists (idempotent).
gh label create "$LABEL" --color b60205 --force >/dev/null 2>&1 || true

TOTAL=$(printf '%s\n' "$PRS" | sed '/^$/d' | wc -l | tr -d ' ')
echo "==> Checking $TOTAL PRs"
CONFLICT=0
CLEAN=0
SKIP=0

while read -r N BASE; do
  [ -z "$N" ] && continue
  # Skip PRs whose head/base refs we don't have locally (e.g. deleted
  # branches) - merging is not computable, so leave the label alone.
  if ! git rev-parse --verify -q "refs/remotes/origin/pr/$N" >/dev/null ||
     ! git rev-parse --verify -q "refs/remotes/origin/$BASE" >/dev/null; then
    echo "PR #$N: refs missing, skipping"
    SKIP=$((SKIP+1))
    continue
  fi

  if git merge-tree --write-tree --name-only \
      "refs/remotes/origin/$BASE" "refs/remotes/origin/pr/$N" >/dev/null 2>&1; then
    # Exit 0: merges cleanly.
    gh pr edit "$N" --remove-label "$LABEL" >/dev/null 2>&1 || true
    echo "PR #$N: clean"
    CLEAN=$((CLEAN+1))
  else
    RC=$?
    if [ "$RC" -eq 1 ]; then
      # Exit 1: the two branches conflict.
      gh pr edit "$N" --add-label "$LABEL" >/dev/null 2>&1 || true
      echo "PR #$N: CONFLICT"
      CONFLICT=$((CONFLICT+1))
    else
      # Any other exit code is an error - don't guess, leave the label alone.
      echo "PR #$N: merge-tree error (rc=$RC), leaving label alone"
      SKIP=$((SKIP+1))
    fi
  fi
done <<< "$PRS"

echo
echo "==> Done: $CONFLICT conflicting, $CLEAN clean, $SKIP skipped"
