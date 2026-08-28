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
QUOTA_SECONDS=3600                       # CodeRabbit included-review cap is ~1 hour
TRIGGER_TS="$(date -u +%s)"               # baseline: this run's trigger time
last_trigger=0                            # epoch of the most recent successful trigger

# Echo "<created_at>|<action_performed>|<rate_limited>" for a PR's newest bot
# comment. Booleans are jq "true"/"false"; "none|false|false" when none exists.
bot_status() {
  gh api "repos/$REPO/issues/$1/comments?per_page=100" \
    --jq '[.[] | select(.user.login=="coderabbitai[bot]")] | sort_by(.created_at) | reverse | if length > 0 then .[0].created_at + "|" + (if (.[0].body // "") | test("Action performed") then "true" else "false" end) + "|" + (if (.[0].body // "") | test("rate limited";"i") then "true" else "false" end) else "none|false|false" end' \
    2>/dev/null || echo "none|false|false"
}

# Convert a GitHub ISO-8601 UTC timestamp (or "none"/empty) to epoch seconds.
to_epoch() {
  [ -n "$1" ] && [ "$1" != "none" ] && date -u -d "$1" +%s 2>/dev/null || echo 0
}

while [ $processed -lt "${#pending[@]}" ]; do
  pr="${pending[$processed]}"

  # Pre-trigger skip: an older "Action performed" reply from a previous review
  # cycle must NOT suppress a fresh request. Only skip when the reply was
  # created after this run's trigger.
  IFS='|' read -r last_created last_action last_rate <<< "$(bot_status "$pr")"
  last_ts="$(to_epoch "$last_created")"
  if [ "$last_action" = "true" ] && [ "$last_ts" -gt "$TRIGGER_TS" ]; then
    echo "$(date -u +%H:%M) #$pr already reviewed (skip)" >> "$LOG"
    processed=$((processed+1))
    continue
  fi

  # Enforce the one-hour review quota: wait for the window to elapse since the
  # previous trigger before firing the next one (replaces the old fixed sleeps).
  now="$(date -u +%s)"
  if [ "$last_trigger" -gt 0 ]; then
    elapsed=$((now - last_trigger))
    if [ "$elapsed" -lt "$QUOTA_SECONDS" ]; then
      wait_for=$((QUOTA_SECONDS - elapsed))
      echo "$(date -u +%H:%M) #$pr waiting ${wait_for}s for review quota window" >> "$LOG"
      sleep "$wait_for"
    fi
  fi

  # Send the review trigger, checking its exit status before logging success.
  pr_trigger_ts="$(date -u +%s)"
  if ! gh pr comment "$pr" --body "@coderabbitai full review" >/dev/null 2>&1; then
    echo "$(date -u +%H:%M) #$pr trigger FAILED" >> "$LOG"
    processed=$((processed+1))
    continue
  fi
  last_trigger="$pr_trigger_ts"
  echo "$(date -u +%H:%M) #$pr trigger sent" >> "$LOG"

  # Wait for CodeRabbit's reply on *this* trigger only.
  for i in $(seq 1 20); do
    sleep 15
    IFS='|' read -r latest_created latest_action latest_rate <<< "$(bot_status "$pr")"
    latest_ts="$(to_epoch "$latest_created")"
    if [ "$latest_action" = "true" ] && [ "$latest_ts" -gt "$pr_trigger_ts" ]; then
      echo "$(date -u +%H:%M) PR $pr REVIEW OK" >> "$LOG"
      break
    fi
    if [ "$latest_rate" = "true" ]; then
      echo "$(date -u +%H:%M) PR $pr rate-limited" >> "$LOG"
      break
    fi
  done
  processed=$((processed+1))
done
echo "$(date -u +%H:%M) pacer finished" >> "$LOG"
