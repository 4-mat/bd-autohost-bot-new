#!/usr/bin/env bash
# agent-prompt.sh — send a prompt to an existing opencode agent session
# Usage: ./agent-prompt.sh [--session <id>] [--port <port>] "<prompt>"

set -euo pipefail

SESSION_ID=""
PORT=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --session) SESSION_ID="$2"; shift 2 ;;
        --port) PORT="$2"; shift 2 ;;
        *) PROMPT="$1"; shift ;;
    esac
done

[[ -z "$SESSION_ID" || -z "$PORT" || -z "$PROMPT" ]] && {
    echo "Usage: $0 --session <id> --port <port> \"<prompt>\""
    exit 1
}

# Send prompt to opencode API
curl -s -X POST "http://127.0.0.1:$PORT/api/session/$SESSION_ID/prompt" \
    -H "Content-Type: application/json" \
    -d "{\"prompt\": $(jq -n --arg p "$PROMPT" '$p')}" \
    > /dev/null

echo "→ Sent prompt to session $SESSION_ID on port $PORT"