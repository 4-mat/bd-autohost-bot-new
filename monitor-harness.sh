#!/usr/bin/env bash
# monitor-harness.sh — watch the coordinator harness log and surface fleet events.
# Usage: ./monitor-harness.sh [--once | --loop]
#   --once   print current fleet health + last 12 events, then exit
#   --loop   tail -f the log continuously, prefixing worker-health and key events

set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG="$ROOT/fleet-status.log"
KEYWORDS="DOWN|respawn|nudge|stalled|ok —|routing|spawn|merged|Review|conflict|MERGE|assign"

if [[ "${1:-}" == "--once" ]]; then
    echo "=== fleet health (from $LOG tail) ==="
    tail -60 "$LOG" | grep -E "ok —|DOWN|respawn|stalled|nudge" | tail -12
    echo
    echo "=== last events ==="
    tail -200 "$LOG" | grep -E "$KEYWORDS" | tail -12
    exit 0
fi

echo "Monitoring $LOG (Ctrl-C to stop)..."
tail -F "$LOG" | while read -r line; do
    if echo "$line" | grep -qE "DOWN|respawn|stalled|nudge"; then
        echo "[!!] $line"
    elif echo "$line" | grep -qE "ok —|merged|Review completed|conflict|MERGE ready"; then
        echo "[ok] $line"
    fi
done