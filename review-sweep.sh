#!/usr/bin/env bash
# review-sweep.sh — run the GROUNDED per-file ollama reviewer across every open PR
# and consolidate into review-sweep-report.txt. NOT rate-limited (unlike CodeRabbit).
# Usage: ./review-sweep.sh [--prs "268 270 ..."] [--model qwen2.5:7b]
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
MODEL="${MODEL:-qwen2.5:7b}"
PARALLEL="${PARALLEL:-3}"          # thinPC-safe default
REPORT="$ROOT/review-sweep-report.txt"
WORK="$ROOT/.review-sweep-work"
mkdir -p "$WORK"

if [[ -n "${PRS:-}" ]]; then
    PR_LIST="$PRS"
else
    PR_LIST="$(gh pr list --state open --limit 40 --json number --jq '.[].number' | tr '\n' ' ')"
fi
PRS_ARRAY=($PR_LIST)
echo "Sweeping ${#PRS_ARRAY[@]} PRs (model=$MODEL parallel=$PARALLEL)..."

for n in "${PRS_ARRAY[@]}"; do rm -f "$WORK/pr-$n.txt"; done

launch_review() {
    local n="$1"
    PYTHONIOENCODING=utf-8 timeout 600 python "$ROOT/review-pr.py" --pr "$n" --model "$MODEL" \
        > "$WORK/pr-$n.txt" 2>&1
}

active=0
for n in "${PRS_ARRAY[@]}"; do
    launch_review "$n" &
    active=$((active+1))
    if (( active >= PARALLEL )); then
        wait -n 2>/dev/null || wait
        active=$((active-1))
    fi
done
wait 2>/dev/null

echo "# Review sweep — $(date)" > "$REPORT"
echo "PRs swept: ${PRS_ARRAY[*]}" >> "$REPORT"
echo >> "$REPORT"
for n in "${PRS_ARRAY[@]}"; do
    f="$WORK/pr-$n.txt"
    echo "===================================================================" >> "$REPORT"
    echo "# PR $n" >> "$REPORT"
    if [[ ! -s "$f" ]]; then
        echo "(no output — review failed/hung)" >> "$REPORT"
        continue
    fi
    cat "$f" >> "$REPORT"
done

# Top line per PR for a quick summary
echo
echo "=== SUMMARY (findings per PR) ==="
for n in "${PRS_ARRAY[@]}"; do
    f="$WORK/pr-$n.txt"
    c=$(grep -c "\[FINDINGS\]" "$f" 2>/dev/null || true)
    echo "#$n: $c file(s) with findings"
done
echo
echo "Full report: $REPORT"