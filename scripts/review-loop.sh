#!/usr/bin/env bash
# Review-loop helper: track CodeRabbit + PR-Agent review state across all open PRs.
# Usage:
#   scripts/review-loop.sh status            - table: PR, head oid, last bot review, staleness
#   scripts/review-loop.sh findings <pr...> - newest CodeRabbit/PR-Agent review bodies per PR
#   scripts/review-loop.sh triggers         - PRs needing a fresh @coderabbitai full review
set -euo pipefail
REPO="4-mat/bd-autohost-bot-new"
cd "$(git rev-parse --show-toplevel)"

prs() {
  gh pr list --state open --limit 60 --json number,headRefOid,headRefName --jq '.[] | "\(.number)\t\(.headRefOid)\t\(.headRefName)"'
}

status() {
  echo -e "PR\tbranch\tbot_review_at\tbot_state\thead_sha\tstale?"
  while IFS=$'\t' read -r num head headref; do
    local latest_review latest_state
    latest_review=$(gh api "repos/$REPO/pulls/$num/reviews?per_page=100" --jq '[.[] | select(.user.login=="coderabbitai[bot]")][0].submitted_at // "-"' 2>/dev/null || echo "-")
    latest_state=$(gh api "repos/$REPO/pulls/$num/reviews?per_page=100" --jq '[.[] | select(.user.login=="coderabbitai[bot]")][0].state // "-"' 2>/dev/null || echo "-")
    local last_reply
    last_reply=$(gh api "repos/$REPO/issues/$num/comments?per_page=100" --jq '[.[] | select(.user.login=="coderabbitai[bot]")][0].created_at // "-"' 2>/dev/null || echo "-")
    echo -e "$num\t${head:0:7}\t${latest_review:0:16}\t$latest_state\treply=$last_reply"
  done < <(prs)
}

findings() {
  local num="$1"
  echo "===== PR #$num ====="
  gh api "repos/$REPO/pulls/$num/reviews?per_page=100" --jq '.[] | select(.user.login|contains("coderabbitai") or contains("qodo")) | "\n--- \(.state) \(.submitted_at) ---\n\(.body[0:4000])"' 2>/dev/null | head -120
}

trigger_review() {
  local num=$1
  body="${2:-}"
  if [ -n "$body" ]; then
    gh pr comment "$num" --body "$body" >/dev/null 2>&1 && echo "triggered #$num"
  else
    gh pr comment "$num" --body "@coderabbitai full review" >/dev/null 2>&1 | echo "triggered #$num"
  fi
}

# PRs whose last CodeRabbit activity predates a push AFTER their last review/reply,
# or whose latest bot reply was a rate-limit error.
needs_review() {
  while IFS=$'\t' read -r num head headref; do
    local last_review=$(gh api "repos/$REPO/pulls/$num/reviews?per_page=100" --jq '[.[] | select(.user.login=="coderabbitai[bot]")][0].submitted_at // ""' 2>/dev/null || echo "")
    local last_reply
    last_reply=$(gh api "repos/$REPO/issues/$num/comments?per_page=100" --jq '[.[] | select(.user.login=="coderabbitai[bot]")][0].body // ""' 2>/dev/null || echo "")
    if echo "$last_reply" | grep -qi "rate limit"; then
      echo "$num rate-limited"
    elif [ -z "$last_review" ]; then
      echo "$num no-review"
    else
      # staleness check via commits list
      local last_commit
      last_commit=$(gh api "repos/$REPO/pulls/$num/commits?per_page=100" --jq '.[-1].commit.author.date // ""' 2>/dev/null || echo "")
      if [ -n "$last_review" ] && [ -n "$last_commit" ] && [[ "$last_commit" > "$last_review" ]]; then
        echo "$num stale (commit $last_commit > review $last_review)"
      fi
    fi
  done < <(prs)
}

case "${1:-status}" in
  status) status ;;
  findings) findings "$2" ;;
  trigger) trigger_review "$2" "$3";;
  needs) needs_review ;;
  *)
    echo "unknown command: $1" >&2
    exit 1
    ;;
esac