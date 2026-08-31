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
REPO="4-mat/bd-autohost-bot-new"
PRS_ARG="${*:-}"

cd "$(git rev-parse --show-toplevel)"

echo "==> Fetching PR heads + base branches"
git fetch origin "+refs/pull/*/head:refs/remotes/origin/pr/*" --quiet
git fetch origin "+refs/heads/*:refs/remotes/origin/*" --quiet

CONFLICT=0
CLEAN=0
SKIP=0

if [ -n "$PRS_ARG" ]; then
  PRS=""
  for N in $PRS_ARG; do
    BASE=$(gh pr view "$N" --json baseRefName --jq .baseRefName 2>/dev/null || echo "")
    if [ -n "$BASE" ]; then
      PRS="$PRS
$N $BASE"
    else
      echo "PR #$N: gh pr view failed — lookup skipped" >&2
      SKIP=$((SKIP+1))
    fi
  done
else
  # Paginate so every open PR is processed instead of truncating at 100.
  PRS=$(gh api "repos/$REPO/pulls?state=open&per_page=100" --paginate --jq '.[] | "\(.number) \(.baseRefName)"')
fi

gh label create "$LABEL" --color b60205 --force >/dev/null 2>&1 || true

TOTAL=$(printf '%s\n' "$PRS" | sed '/^$/d' | wc -l | tr -d ' ')
echo "==> Checking $TOTAL PRs"

while read -r N BASE; do
  [ -z "$N" ] && continue
  if ! git rev-parse --verify -q "refs/remotes/origin/pr/$N" >/dev/null ||
     ! git rev-parse --verify -q "refs/remotes/origin/$BASE" >/dev/null; then
    echo "PR #$N: refs missing, skipping"
    SKIP=$((SKIP+1))
    continue
  fi

  set +e
  git merge-tree --write-tree --name-only \
      "refs/remotes/origin/$BASE" "refs/remotes/origin/pr/$N" >/dev/null 2>&1
  RC=$?
  set -e
  if [ "$RC" -eq 0 ]; then
    gh pr edit "$N" --remove-label "$LABEL" >/dev/null 2>&1 || true
    echo "PR #$N: clean"
    CLEAN=$((CLEAN+1))
  elif [ "$RC" -eq 1 ]; then
    gh pr edit "$N" --add-label "$LABEL" >/dev/null 2>&1 || true
    echo "PR #$N: CONFLICT"
    CONFLICT=$((CONFLICT+1))
  else
    echo "PR #$N: merge-tree error (rc=$RC), leaving label alone"
    SKIP=$((SKIP+1))
  fi
done <<< "$PRS"

echo
echo "==> Done: $CONFLICT conflicting, $CLEAN clean, $SKIP skipped"
