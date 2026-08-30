# Handoff: Swarm PR-Review Fleet (continued operation)

**You are taking over the running agent fleet that reviews and fixes PRs in this repo.
Believe the live state you check, not the ages of these notes — the fleet is alive and
self-healing right now, but always re-verify before acting.**

## 0. Goal of the swarm

The swarm is a **self-driving PR review-and-fix pipeline** for this repo. Instead of one
agent doing a single review at a time, it runs specialized workers on persistent sessions
that continuously triage, review, fix, and verify the open pull requests, while the
deterministic harness (`coordinator-harness.py`) restarts dead workers and nudges stalled
ones so the fleet keeps working unattended.

**Mission:** keep every open PR moving toward mergeable — each one gets reviewed for real
issues, the findings get fixed by a worker that owns that PR, and a *separate* worker
independently verifies the fixes landed. One agent's/model's judgment is never the last word.

**The division of labor (encoded in each worker's `assignment`):**

| Worker | Role in the goal |
|--------|------------------|
| worker-a / worker-b | Own specific PRs; act on review findings, fix confirmed issues, run verification, report to the coordinator. |
| worker-c (independent verifier) | Does **not** edit/push/merge. Audits findings, reports `FIXED/NOT FIXED` — independent check that fixes actually landed. |
| worker-d (mirror auditor) | Audits open mirror PRs, reports findings only. |
| review-waiter | Owns the review queue and the CodeRabbit slot: polls for the next review window, posts plain-text review-ready comments. |
| worker-e | Owns the remaining-PR queue + stack order; audits ancestry/conflicts so reviewers don't waste effort on PRs doomed to conflict. |
| fleet-supervisor | Fleet manager: monitors sessions, prevents duplicate assignments, reprioritizes the queue, escalates failures to the coordinator. Doesn't touch PR code. |

**Coherence guardrails (baked into the assignments):** no duplicated work (supervisor
polices overlap); verifiers never edit (doer/checker separation); work is coordinated
around the real CodeRabbit service's slot instead of stepping on it; workers report
blockers through the coordinator inbox rather than pushing/merging on their own authority.

**What it's *not* for:** pushing/merging on its own authority; the broad per-file findings
sweep (`review-sweep.sh` is a separate grounded ollama pass); CI/release concerns.

## 1. What the fleet is

This repo runs a "swarm" of 7 AI workers that do PR reviews / fixes. The deterministic
babysitter is `coordinator-harness.py`; the workers run `serve` on local ports with
persistent sessions. All of these files are locally git-ignored under the
`# Local swarm harness` block and are NOT committed:

- `agent-assignments.json` — source of truth: `worker -> {runtime, port, model, repo, session, assignment}`
- `agent-registry.json`, `provider-routing.json`, `pr263-swarm.json`
- `launch-one-worker.ps1` — the **reliable** per-worker launcher (serve + create session + deliver assignment + attach TUI). Handles both `chipotlai` (bun) and `opencode` runtimes.
- `spawn-workers-batched.ps1` — spawns every worker as a Windows-Terminal tab running `launch-one-worker.ps1`
- `spawn-agent.sh` — the harness's respawn path. **Caveat: it only spawns the standalone `opencode` binary, so it cannot cleanly recreate the Chipotlai (bun) workers.**
- `agent-prompt.sh`, `swarm-message.sh`, `swarm-broadcast.sh` — send prompts to a session
- `coordinator-harness.py` — health-checks every agent each pass: dead port → respawn, empty/stalled session → nudge, then respawn after `MAX_NUDGES`
- `monitor-harness.sh --once|--loop` — human-friendly tail of `fleet-status.log`
- `review-sweep.sh` — the GROUNDED per-file ollama reviewer across all open PRs → `review-sweep-report.txt`, scratch in `.review-sweep-work/`

## 2. Current state (verified 18:26, this handoff)

**All 7 worker ports are up** (HTTP 200 on `/server/health`):

| worker | runtime  | port | role |
|--------|----------|------|------|
| worker-a | chipotlai | 4138 | PR #260 follow-up review / fixes |
| worker-b | chipotlai | 4122 | PR #269 fix (chat echo + GUI routing in test-app.ts) |
| worker-c | chipotlai | 4125 | independent verifier (audits review findings, FIXED/NOT FIXED) |
| worker-d | chipotlai | 4126 | mirror auditor |
| review-waiter | opencode | 4139 | review-queue owner / waits for next CodeRabbit slot |
| worker-e   | opencode   | 4127 | remaining open-PR queue + stack-order audit |
| fleet-supervisor | opencode | 4114 | fleet manager / waits on worker reports |

- `coordinator-harness.py --loop` is running (pid in `.coordinator-harness.pid`).
- Sessions in `agent-assignments.json` were reconciled to fresh IDs on this handoff:
  - worker-a `ses_fac163259ffeOg09k2bYIGlhA1`
  - worker-b `ses_fac255505ffe6XdqyDuUfEOeBM`
  - worker-c `ses_fac25550bffe3fHb6gW3mJPbQY`
  - worker-d `ses_fac254f3cffe9kRIsiXeyzBIg2`
  - review-waiter `ses_fac1654e7ffe23VrVxB3c1SrJo`
  - worker-e `ses_fac2670adffekFLW17zRRSPkiL`
  - fleet-supervisor `ses_fac1654d2ffePR5Dk6zrwnevyO`
- Last open-PR review targets in `.review-sweep-work/`: **#283, #284, #285**.
- Harness hardening landed this handoff (see §3) — keep it.

## 3. Things fixed this handoff (don't regress these)

1. **Stale coordinator pidfile.** Previous harness died; `.coordinator-harness.pid` held a dead PID so `--loop` refused to start. Remove `rm -f .coordinator-harness.pid` before a fresh start.
2. **3 workers failed to bind** (worker-a, review-waiter, fleet-supervisor started servers that never listened). Relaunched each via `launch-one-worker.ps1 -Worker <name>` (in its own window), which is the path that actually works.
3. **Session-ID clobbering.** The launcher windows each rewrite `agent-assignments.json`, and concurrent writes race — a stale worker's window can overwrite a healthy worker's fresh session with an old one. Fix: reconcile against the live DB (see §6) and restart the harness so it re-reads.
4. **Harness hardening (`coordinator-harness.py`):**
   - `safe_load()` reads with `utf-8-sig` — the PowerShell launchers write a UTF-8 BOM that previously crashed `json.load` on any restart.
   - `--loop` now **re-reads `agent-assignments.json` every pass** instead of holding a startup snapshot, so newly-registered sessions are picked up instead of tracking stale ones forever. Each pass skips (instead of dying) if the file is transiently mid-write/BOM'd.

## 4. Operating the fleet

```bash
# See current health + last events from fleet-status.log
./monitor-harness.sh --once
# Live monitor (Ctrl-C to stop)
./monitor-harness.sh --loop
# Harness: one pass to see what it would do (non-destructive)
python3 coordinator-harness.py --once --dry-run
# Start the babysitter (loop, every 10 min). Remove stale pidfile first.
rm -f .coordinator-harness.pid
nohup python3 coordinator-harness.py --loop --interval-min 10 >> coordinator.log 2>&1 &
# Relaunch a specific worker (the reliable path)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File launch-one-worker.ps1 -Worker worker-b
```

Useful checks:
```bash
# worker health by port
for p in 4114 4113 4122 4125 4126 4127 4138 4139; do \
  code=$(curl -s -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$p/server/health"); \
  echo "$p => $code"; done
# readable view of assignments (BOM-tolerant)
python3 -c "import json;d=json.load(open('agent-assignments.json',encoding='utf-8-sig'));\
[print(n,'->',(c.get('session') or '')[:28],c.get('port'),c.get('runtime')) for n,c in d.items()]"
```

## 5. Next steps to continue PR reviews

1. **Let the harness finish stabilizing worker-a and worker-b** — they were freshly relaunched and only had 1 part (assignment) when handed off. worker-b responded to a nudge (1→2 parts). If a Chipotlai worker is *stalled* rather than hard-down, the harness nudges twice (~20 min) then respawns — but its respawn uses `opencode` only. **If a chipotlai worker needs a clean restart, do it manually** with `launch-one-worker.ps1 -Worker <name>`.
2. **Check worker output** (the TUI tabs, or part counts in the DBs) and route any findings to the coordinator/fleet-supervisor via `swarm-message.sh`.
3. **Re-run the grounded sweep** once workers settle, to refresh findings on the current open PRs (targets #283/#284/#285; the sweep scripts pick up all open PRs automatically):
   ```bash
   ./review-sweep.sh            # all open PRs, model qwen2.5:7b, parallel 3
   ./review-sweep.sh --prs "283 284 285"
   ```
4. Watch the queue rules in the assignments: review-waiter owns the CodeRabbit slot and plain-text ready comments; worker-e owns ancestry/conflict audits so stacked PRs aren't duplicated.
5. If you need guidance on a specific flow, `README.md` covers the app; `HANDOFF_PROMPT.md` is an older single-PR handoff (still useful as a format example).

## 6. Gotchas / when in doubt

- **`agent-assignments.json` is BOM'd + rewritten by launchers.** Always read it with `utf-8-sig`. Don't rewrite it with `Set-Content -Encoding UTF8` from PowerShell — that adds a BOM. Python: `json.load(open(p, encoding='utf-8'))` after stripping, or use `utf-8-sig`.
- **Concurrent launcher writes race.** After relaunching several workers, re-reconcile `session` fields against the live DB before trusting the file (the running harness re-reads each pass, but a relaunch window's late write can clobber a healthy worker's ID).
- **How to reconcile a worker's true session**, read the DB the runtime persists to:
  - chipotlai workers → `~/.local/share/opencode/opencode-local.db`
  - opencode-binary workers → `~/.local/share/opencode/opencode.db`
  - Chipotlai `serve` servers share the same session pool (all read the same DB), so don't try to map via `GET /session` per-port — match by recent `time_created` (~the relaunch time) instead.
- **Chipotlai servers share one session DB** — `/session` on port A will list port B's sessions too. Prefer the DB's `time_created` to identify a worker's own session.
- **`spawn-agent.sh` = opencode only.** It won't restore a Chipotlai worker correctly; use the `-ps1` launcher for those.
- These harness files are git-ignored and must **not** be committed.