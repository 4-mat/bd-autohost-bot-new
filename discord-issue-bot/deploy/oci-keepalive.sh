#!/usr/bin/env bash
#
# OCI Always-Free "idle" insurance.
#
# Oracle reclaims Always Free instances whose CPU, network AND memory all
# stay under 20% (95th percentile) for 7 consecutive days. A quiet Discord
# bot looks idle by that measure, so this task gives the instance ~10
# minutes of low-priority single-core activity every 2 hours (installed by
# oci-bootstrap.sh as a cron job). The bot is never affected because the
# work runs at `nice -n 19`.
#
# Safe to remove: `crontab -e` and delete the oci-keepalive.sh line.
#
set -euo pipefail

END=$(( $(date +%s) + 600 ))   # ~10 minutes

while [ "$(date +%s)" -lt "$END" ]; do
  # ~5-10s of single-core churn per iteration, lowest priority
  nice -n 19 node -e 'let x=0; for (let i=0; i<2e9; i++){ x=(x+i)%13 }' 2>/dev/null || true
  # a little network activity as well
  curl -s -o /dev/null --max-time 5 https://example.com 2>/dev/null || true
done

exit 0
