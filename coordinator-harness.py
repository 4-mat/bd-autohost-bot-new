#!/usr/bin/env python3
"""
coordinator-harness.py — deterministic babysitter for the agent fleet.

Replaces the "LLM polls everything" coordinator loop with a mechanical script:
  1. port health check for every agent in agent-assignments.json
  2. dead port        -> respawn via spawn-agent.sh with the saved assignment
  3. empty shell session (0 parts) -> respawn (prompt delivery failed)
  4. stalled session  (no new parts for STALL_MIN while port is up)
                      -> tool-forced CONTINUE nudge via agent-prompt.sh
                      -> after MAX_NUDGES consecutive, respawn instead
  5. everything it does goes to stdout + fleet-status.log

Usage:
  python3 coordinator-harness.py --once            # single pass, fix things now
  python3 coordinator-harness.py --loop            # run forever, every INTERVAL_MIN
  python3 coordinator-harness.py --once --dry-run  # show actions without taking them
"""

import argparse
import json
import os
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
ASSIGNMENTS = os.path.join(ROOT, "agent-assignments.json")
ROUTING = os.path.join(ROOT, "provider-routing.json")
REGISTRY = os.path.join(ROOT, "agent-registry.json")
LOG = os.path.join(ROOT, "fleet-status.log")
PIDFILE = os.path.join(ROOT, ".coordinator-harness.pid")
DB = os.path.expanduser("~/.local/share/opencode/opencode-local.db")

STALL_MIN = 15  # minutes without any new part -> stalled (DB writes lag!)
SHELL_GRACE_MIN = 10  # a session younger than this may not be flushed to DB yet
RESPAWN_COOLDOWN_MIN = 20
MAX_NUDGES = 2  # consecutive nudges before we give up and respawn

NUDGE = (
    "CONTINUE (tool-forced): resume your assigned task NOW. "
    "Call the bash tool immediately to check your current step, then keep executing. "
    "Do not ask questions, do not summarize — act."
)

_spawned_at = {}  # name -> epoch of last respawn, for cooldown
_nudges = {}  # name -> consecutive nudge count


def log(msg):
    line = f"[{datetime.now(timezone.utc).strftime('%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def port_alive(port):
    try:
        out = subprocess.run(
            [
                "curl",
                "-s",
                "-m",
                "2",
                "-o",
                "/dev/null",
                "-w",
                "%{http_code}",
                f"http://127.0.0.1:{port}/server/health",
            ],
            capture_output=True,
            text=True,
            timeout=6,
        )
        return out.stdout.strip() == "200"
    except Exception:
        return False


def session_stats(session_id):
    """(part_count, last_part_epoch_ms, session_created_ms) or (0, 0, 0)."""
    try:
        con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=5)
        con.execute("PRAGMA busy_timeout=4000")
        n, last = con.execute(
            "SELECT COUNT(*), COALESCE(MAX(time_updated),0) FROM part WHERE session_id=?",
            (session_id,),
        ).fetchone()
        created = con.execute(
            "SELECT COALESCE(time_created,0) FROM session WHERE id=?", (session_id,)
        ).fetchone()
        con.close()
        return n or 0, last or 0, (created[0] if created else 0) or 0
    except Exception as e:
        log(f"  db error for {session_id[:22]}: {e}")
        return 0, 0, 0


def agent_prompt(name, session_id, port, text):
    subprocess.run(
        [
            "bash",
            os.path.join(ROOT, "agent-prompt.sh"),
            "--session",
            session_id,
            "--port",
            str(port),
            text,
        ],
        capture_output=True,
        text=True,
        timeout=90,
    )


def configured_model(model):
    provider, _, model_id = model.partition("/")
    if provider == "ollama":
        return port_alive(11434)
    if provider == "opencode":
        # Chipotlai/OpenCode models are selected by the local OpenCode server;
        # the spawn helper performs the actual availability check.
        return True
    if provider in {"groq", "google", "openrouter"}:
        env = {
            "groq": "GROQ_API_KEY",
            "google": "GEMINI_API_KEY",
            "openrouter": "OPENROUTER_API_KEY",
        }[provider]
        return bool(os.environ.get(env))
    return True


def choose_model(name, cfg):
    try:
        with open(ROUTING, encoding="utf-8") as f:
            routes = json.load(f).get("roles", {}).get(name, [])
        for candidate in routes:
            if configured_model(candidate):
                return candidate
    except Exception as e:
        log(f"  routing lookup failed for {name}: {e}")
    return cfg["model"]


def respawn(name, cfg, dry):
    selected_model = choose_model(name, cfg)
    if dry:
        log(
            f"  [dry-run] would respawn {name} on port {cfg['port']} with {selected_model}"
        )
        return
    subprocess.run(
        [
            "bash",
            os.path.join(ROOT, "spawn-agent.sh"),
            name,
            "--repo",
            cfg["repo"],
            "--port",
            str(cfg["port"]),
            "--model",
            selected_model,
            "--prompt",
            cfg["assignment"],
        ],
        capture_output=True,
        text=True,
        timeout=240,
    )
    _spawned_at[name] = time.time()
    _nudges[name] = 0
    # pull the fresh session id out of the registry so stall checks track it
    new_sid = cfg.get("session")
    try:
        with open(REGISTRY, encoding="utf-8") as f:
            reg = json.load(f)
        entry = (
            reg.get(name)
            if isinstance(reg, dict)
            else next((e for e in reg if e.get("name") == name), None)
        )
        if entry:
            sid = (
                entry.get("session") or entry.get("sessionId") or entry.get("sessionID")
            )
            if sid:
                new_sid = sid
    except Exception:
        pass
    cfg["model"] = selected_model
    log(
        f"  respawned {name} -> port {cfg['port']} model {selected_model} session {str(new_sid)[:26]}"
    )
    # persist so a harness restart doesn't chase the stale session id
    cfg["session"] = new_sid
    try:
        with open(ASSIGNMENTS, encoding="utf-8") as f:
            all_a = json.load(f)
        all_a[name]["session"] = new_sid
        with open(ASSIGNMENTS, "w", encoding="utf-8") as f:
            json.dump(all_a, f, indent=2)
    except Exception as e:
        log(f"  warn: could not persist session for {name}: {e}")
    return new_sid


def check_agent(name, cfg, dry):
    port = int(cfg["port"])
    sid = str(cfg.get("session", "")).strip()
    if not sid:
        log(f"{name}: missing session in assignments -> skipping stale port {port}")
        return
    if not port_alive(port):
        last = _spawned_at.get(name, 0)
        if time.time() - last < RESPAWN_COOLDOWN_MIN * 60:
            log(f"{name}: port {port} down, respawn cooldown active")
            return
        log(f"{name}: port {port} DOWN -> respawning")
        new_sid = respawn(name, cfg, dry)
        if new_sid:
            cfg["session"] = new_sid
        return

    parts, last_ms, created_ms = session_stats(sid)
    now_ms = time.time() * 1000
    quiet_min = (now_ms - last_ms) / 60000 if last_ms else 999
    age_min = (now_ms - created_ms) / 60000 if created_ms else 999

    if parts == 0 and age_min > SHELL_GRACE_MIN:
        # the fork batches DB writes — a brand-new session may legitimately
        # show 0 parts until its first flush, so only older shells count
        log(
            f"{name}: EMPTY SHELL session (0 parts, {age_min:.0f} min old) -> respawning"
        )
        new_sid = respawn(name, cfg, dry)
        if new_sid:
            cfg["session"] = new_sid
        return

    if parts == 0:
        log(
            f"{name}: 0 parts but session only {age_min:.0f} min old — waiting for DB flush"
        )
        return

    if quiet_min > STALL_MIN:
        count = _nudges.get(name, 0)
        if count >= MAX_NUDGES:
            log(
                f"{name}: stalled {quiet_min:.0f} min after {count} nudges -> respawning"
            )
            new_sid = respawn(name, cfg, dry)
            if new_sid:
                cfg["session"] = new_sid
        else:
            log(
                f"{name}: stalled {quiet_min:.0f} min -> nudge {count + 1}/{MAX_NUDGES}"
            )
            if not dry:
                agent_prompt(name, sid, port, NUDGE)
            _nudges[name] = count + 1
    else:
        _nudges[name] = 0
        log(f"{name}: ok — {parts} parts, active {quiet_min:.1f} min ago")


def run_pass(assignments, dry):
    log(f"— pass start ({'dry-run' if dry else 'live'}) —")
    for name, cfg in assignments.items():
        try:
            check_agent(name, cfg, dry)
        except Exception as e:
            log(f"{name}: check failed: {e}")
    log("— pass end —")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--interval-min", type=float, default=10)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not args.once and not args.loop:
        ap.error("pick --once or --loop")

    with open(ASSIGNMENTS, encoding="utf-8") as f:
        assignments = json.load(f)

    if args.loop:
        if os.path.exists(PIDFILE):
            log(f"refusing to start: pidfile exists ({PIDFILE})")
            sys.exit(1)
        with open(PIDFILE, "w") as f:
            f.write(str(os.getpid()))
        try:
            while True:
                run_pass(assignments, args.dry_run)
                time.sleep(args.interval_min * 60)
        finally:
            os.remove(PIDFILE)
    else:
        run_pass(assignments, args.dry_run)


if __name__ == "__main__":
    main()
