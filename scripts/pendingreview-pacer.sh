#!/usr/bin/env bash
# Paced CodeRabbit full-review requester: works around the ~1/hr included
# review cap by firing one trigger at a time and waiting for the reply.
# Usage: bash scripts/pendingreview-pacer.sh <pr1> <pr2> ...
# Writes one line per outcome to scripts/pendingreview-pacer.log
set -euo pipefail
REPO="4-mat/bd-autohost-bot-new"
LOG="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/pendingreview-pacer.log"

pending=("$@")
processed=0
while [ $processed -lt "${#pending[@]}" ]; do
  pr="${pending[$processed]}"
  last=$(gh api "repos/$REPO/issues/$pr/comments?per_page=100" \
    --jq '[.[] | select(.user.login=="coderabbitai[bot]")] | sort_by(.created_at) | reverse | .[0].body // ""' 2>/dev/null || echo "")
  if printf '%s' "$last" | grep -q "Action performed"; then
    echo "$(date -u +%H:%M) #$pr already reviewed (skip)" >> "$LOG"
    processed=$((processed+1))
    continue
  fi
  gh pr comment "$pr" --body "@coderabbitai full review" >/dev/null 2>&1 || true
  echo "$(date -u +%H:%M) #$pr trigger sent" >> "$LOG"
  for i in $(seq 1 20); do
    sleep 15
    latest=$(gh api "repos/$REPO/issues/$pr/comments?per_page=100" \
      --jq '[.[] | select(.user.login=="coderabbitai[bot]")] | sort_by(.created_at) | reverse | .[0].body // ""' 2>/dev/null || echo "")
    if printf '%s' "$latest" | grep -q "Action performed"; then
      echo "$(date -u +%H:%M) PR $pr REVIEW OK" >> "$LOG"
      break
    fi
    if printf '%s' "$latest" | grep -qi "rate limited"; then
      echo "$(date -u +%H:%M) PR $pr rate-limited" >> "$LOG"
      sleep 60
      break
    fi
  done
  processed=$((processed+1))
  sleep 20
done
echo "$(date -u +%H:%M) pacer finished" >> "$LOG"
