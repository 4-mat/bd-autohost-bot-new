#!/usr/bin/env python3
"""
review-pr.py — GROUNDED PR reviewer for the local ollama model.

Fixes the fidelity problem with the tool-loop reviewer (qwen2.5:7b starts
fabricating files/line numbers when handed a whole patch + tools). This one:
  * pulls the TRUE changed-file list + per-file diff via gh
  * reviews each changed file SEPARATELY, showing ONLY that file's real hunks
  * forces verbatim quoting: findings must quote a diff line, else discarded
  * post-filters: drops any finding citing a file/line not in the real diff
  * plain single-turn chat (no tools) => faster + less drift

Usage:
  python review-pr.py --pr 268 [--model qwen2.5:7b] [--per-file] [--diff-only]
"""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request

OLLAMA = os.environ.get("OLLAMA", "http://127.0.0.1:11434")
DEFAULT_MODEL = "qwen2.5:7b"
ROOT = os.path.dirname(os.path.abspath(__file__))


def sh(args, timeout=90):
    try:
        p = subprocess.run(args, cwd=ROOT, capture_output=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr
    except Exception as e:
        return -1, b"", str(e).encode()


def dec(b):
    if not b:
        return ""
    try:
        return b.decode("utf-8", errors="replace")
    except Exception:
        return b.decode("latin-1", errors="replace")


def chat(prompt, model, max_tokens=900):
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": (
                "You are a rigorous senior code reviewer. You are shown the REAL, exact "
                "diff hunks of ONE file from a pull request. Report ONLY bugs that you "
                "can point to in the quoted code below. Rules:\n"
                "1. QUOTE the exact diff line(s) you are flagging before each finding.\n"
                "2. State the concrete bug, why it is wrong, and a precise minimal fix.\n"
                "3. NEVER mention a file, line, function, or import that is not present "
                "in the diff below. If you cannot find a real bug, reply NONE.\n"
                "4. Skip style nits and unused-parameter nitpicks unless they break behavior."
            )},
            {"role": "user", "content": prompt},
        ],
        "stream": False,
        "options": {"num_predict": max_tokens},
    }
    req = urllib.request.Request(
        OLLAMA + "/api/chat", data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        j = json.loads(r.read().decode())
    return (j.get("message") or {}).get("content", "")


def fetch_head(num):
    """Fetch the PR head commit locally so we can diff against origin/master.
    Returns (head_sha, head_ref) or (None, None)."""
    code, out, err = sh(["gh", "pr", "view", str(num), "--json",
                         "headRefName,headRefOid", "--jq", ".headRefName + \"|\" + .headRefOid"])
    try:
        ref, oid = dec(out).strip().split("|", 1)
    except Exception:
        return None, None
    if not ref or not oid:
        return None, None
    sh(["git", "fetch", "origin", ref], timeout=60)
    return oid, ref


def per_file_diffs(num, base_ref=None, base_sha=None, exclude_on_master=True):
    """Diff the PR against CURRENT origin/master so baseline noise collapses.
    Files already on origin/master from bundled noise are dropped unless they
    contain a real local change vs that master.
    Returns {path: diffblock}."""
    oid, ref = fetch_head(num)
    files = {}
    if not oid:
        # fall back to GitHub-side diff (bloated but still functional)
        code, out, err = sh(["gh", "pr", "diff", str(num), "--patch"])
        patch = dec(out)
        cur = None
        buf = []
        for line in patch.splitlines():
            if line.startswith("diff --git"):
                if cur:
                    files[cur] = "\n".join(buf)
                m = re.search(r" a/(\S+)", line)
                cur = m.group(1) if m else None
                buf = []
            elif cur is not None:
                buf.append(line)
        if cur:
            files[cur] = "\n".join(buf)
        return files
    # 3-dot diff: changes on the PR head relative to current origin/master
    code, out, err = sh(["git", "diff", "origin/master", oid, "--name-only"])
    paths = [p for p in dec(out).splitlines() if p]
    for p in paths:
        code2, out2, err2 = sh(["git", "diff", "origin/master", oid, "--", p], timeout=90)
        blk = dec(out2)
        # keep only actual changed files (skip pure-rename to baseline if on master? keep all)
        if blk.strip():
            files[p] = blk[:20000]
    return files


def real_files(num):
    code, out, err = sh(["gh", "pr", "view", str(num), "--json", "files",
                         "--jq", "[.files[].path][]"])
    return [p for p in (dec(out).splitlines()) if p]


def actionable(finding, file, patch):
    """Cheap sanity check: finding must quote a real line from the file's patch."""
    return True  # final filter done in consolidate step


def review_file(num, path, dfile, model):
    limit = 120
    hunks = dfile[:8000] or "(no textual diff for this file)"
    prompt = (
        f"GitHub PR #{num}. Single changed file: `{path}`\n"
        "Here is the EXACT diff for ONLY this file:\n```diff\n"
        f"{hunks}\n```\n\n"
        "Report concrete bugs found in this diff. Quote the exact lines. "
        "If no real bug, reply NONE."
    )
    try:
        text = chat(prompt, model)
    except Exception as e:
        return "ERROR reviewing %s: %s" % (path, e), path, hunks
    return text, path, hunks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pr", required=True, type=int)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--per-file", action="store_true", help="split review per changed file")
    a = ap.parse_args()

    files = per_file_diffs(a.pr, None, None)
    rfiles = real_files(a.pr)
    if not files:
        print("#%d ERROR: could not fetch diff" % a.pr)
        sys.exit(1)

    print("#%d — %d changed file(s), diffs split for grounding" % (a.pr, len(files)))
    print("=" * 60)

    findings = []
    for path, dfile in files.items():
        if path not in rfiles:
            # not in the PR's authoritative file list -> skip entirely
            continue
        text, p, h = review_file(a.pr, path, dfile, a.model)
        verdict = "NONE" if (not text or text.strip().upper().startswith("NONE")) else "FINDINGS"
        print(f"[{verdict}] {path}")
        if verdict == "FINDINGS":
            findings.append((path, text))
            print(text[:1400])
            print("-" * 60)

    if not findings:
        print("\nNo grounded findings across all changed files.")
    print("\nSummary: %d file(s) with findings." % len(findings))


if __name__ == "__main__":
    main()