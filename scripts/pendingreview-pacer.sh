#!/usr/bin/env bash
# Paced CodeRabbit full-review requester: works around the ~1/hr included
# review cap by firing one trigger at a time and waiting for the reply.
# Usage: bash scripts/fullreview-pacer.sh <pr1> <pr2> ... 
# Writes one line per outcome to scripts/fullreview-pacer.log
set -u
REPO="4-mat/bd-autohost-bot-new"
LOG="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/fullreview-pacer.log"

pending=("$@")
processed=0
while [ $processed -lt "${#pending[@]}" ]; do
  pr="${pending[$processed]}"
  # Skip if this PR already got a successful review (via race with another run).
  last=$(gh api "repos/$REPO/issues/$pr/comments?per_page=50" \
    --jq '[.[] | select(.user.login=="coderabbitai[bot]")] | sort_by(.created_at) | reverse | .[0] | .body' 2>/dev/null || echo "")
  if echo "$last" | grep -q "Action performed"; then
    echo "$(date -u +%H:%M) #$pr already reviewed (skip)" >> "$LOG"
    processed=$((processed+1))
    continue
  fi
  gh pr comment "$pr" --body "@coderabbitai full review" >/dev/null 2>&1
  echo "$(date -u +%H:%M) #$pr trigger sent" >> "$LOG"
  # Wait for the bot reply (usually < 2 min).
  for i in $(seq 1 20); do
    sleep 15
    latest=$(gh api "repos/$REPO/issues/$pr/comments?per_page=100" \
      --jq '[.[] | select(.user.login=="coderabbitai[bot]")] | sort_by(.created_at) | reverse | .[0] | .body' 2>/dev/null || echo "")
    if echo "$latest" | grep -q "Action performed"; then
      echo "$(date -u +%H:%M) PR $pr REVIEW OK" >> "$LOG"
      break
    fi
    if echo "$latest" | grep -q "rate limited"; then
      echo "$(date -u +%H:%M) PR $pr rate-limited" >> "$LOG"
      # Give the quota a generous window before trying the next PR.
      sleep 48
      break
    fi
  done
  processed=$((processed+1))
  # Space triggers so we don't cluster and trip the quota.
  sleep 20
done
echo "$(date -u +%H:%M) pacer finished" >> "$LOG"