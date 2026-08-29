#!/usr/bin/env bash
# spawn-agent.sh — launch an opencode agent on a given port with a given prompt
# Usage: ./spawn-agent.sh <name> --repo <path> --port <port> --model <model> --prompt <prompt>

set -euo pipefail

NAME="${1:-}"
shift || true

REPO=""
PORT=""
MODEL=""
PROMPT=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --repo) REPO="$2"; shift 2 ;;
        --port) PORT="$2"; shift 2 ;;
        --model) MODEL="$2"; shift 2 ;;
        --prompt) PROMPT="$2"; shift 2 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

[[ -z "$NAME" || -z "$REPO" || -z "$PORT" || -z "$MODEL" || -z "$PROMPT" ]] && {
    echo "Usage: $0 <name> --repo <path> --port <port> --model <model> --prompt <prompt>"
    exit 1
}

# Kill any existing process on the port
PID_FILE="/tmp/opencode-agents/port-$PORT.json"
mkdir -p /tmp/opencode-agents

# Start the agent
cd "$REPO"
echo "→ Starting $NAME on port $PORT in $REPO"

# Use opencode to start the agent
# Note: This is a simplified version - actual implementation depends on opencode CLI
nohup opencode serve --port "$PORT" --model "$MODEL" > "/tmp/opencode-agents/$NAME.log" 2>&1 &
AGENT_PID=$!

# Wait for health check
for i in {1..30}; do
    if curl -s -m 2 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q "200"; then
        echo "✓ Server up on port $PORT (after ${i}s)"
        echo "$AGENT_PID" > "$PID_FILE"
        break
    fi
    sleep 1
done

# Send initial prompt via agent-prompt.sh if available
if [[ -f "$(dirname "$0")/agent-prompt.sh" ]]; then
    # Get session ID from opencode
    SESSION_ID=$(curl -s "http://127.0.0.1:$PORT/api/session" 2>/dev/null | jq -r '.id // empty')
    if [[ -n "$SESSION_ID" ]]; then
        "$(dirname "$0")/agent-prompt.sh" --session "$SESSION_ID" --port "$PORT" "$PROMPT" &
    fi
fi

echo "=== SPAWNED: $NAME ==="
echo "PORT:    $PORT"
echo "PID:     $AGENT_PID"
echo "Next:    ./agent-prompt.sh --session <session> --port $PORT \"<task>\""