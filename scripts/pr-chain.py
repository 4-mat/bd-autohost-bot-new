#!/usr/bin/env python3
"""Read-only PR chain planner.

The planner never edits GitHub, branches, worktrees, or files. It uses `gh` to
read open PR metadata and emits JSON or a concise human-readable chain.

Usage:
  python scripts/pr-chain.py
  python scripts/pr-chain.py --json
  python scripts/pr-chain.py --prs 269 268
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass, asdict
from typing import Any

REPO = "4-mat/bd-autohost-bot-new"
REQUIRED_BOTS = ("CodeRabbit", "PR Agent")


@dataclass
class PullRequest:
    number: int
    title: str
    base: str
    head: str
    state: str
    draft: bool
    mergeable: str
    approvals: tuple[str, ...]
    checks_pass: bool
    changed_files: int

    @property
    def gate_ready(self) -> bool:
        return (
            self.state == "OPEN"
            and not self.draft
            and self.mergeable == "MERGEABLE"
            and all(bot in self.approvals for bot in REQUIRED_BOTS)
            and self.checks_pass
        )


def gh_json(args: list[str]) -> Any:
    result = subprocess.run(
        ["gh", *args], capture_output=True, text=True, check=False
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "gh command failed")
    return json.loads(result.stdout)


def load_prs(numbers: list[int] | None) -> list[PullRequest]:
    if numbers:
        raw = [
            gh_json(
                [
                    "pr",
                    "view",
                    str(number),
                    "--repo",
                    REPO,
                    "--json",
                    "number,title,baseRefName,headRefName,state,isDraft,mergeable,reviewDecision,statusCheckRollup,files,reviews",
                ]
            )
            for number in numbers
        ]
    else:
        raw = gh_json(
            [
                "pr",
                "list",
                "--repo",
                REPO,
                "--state",
                "open",
                "--limit",
                "100",
                "--json",
                "number,title,baseRefName,headRefName,state,isDraft,mergeable,reviewDecision,statusCheckRollup,files,reviews",
            ]
        )
    return [_parse_pr(item) for item in raw]


def _parse_pr(item: dict[str, Any]) -> PullRequest:
    reviews = item.get("reviews") or []
    approvals = {
        "CodeRabbit"
        if "coderabbitai" in (review.get("author", {}).get("login", "")).lower()
        and review.get("state") == "APPROVED"
        else "PR Agent"
        if "github-actions" in (review.get("author", {}).get("login", "")).lower()
        and review.get("state") == "APPROVED"
        else ""
        for review in reviews
    }
    checks = item.get("statusCheckRollup") or []
    checks_pass = all(
        check.get("conclusion") in (None, "SUCCESS", "NEUTRAL", "SKIPPED")
        for check in checks
    )
    return PullRequest(
        number=item["number"],
        title=item["title"],
        base=item["baseRefName"],
        head=item["headRefName"],
        state=item["state"],
        draft=item["isDraft"],
        mergeable=item.get("mergeable") or "UNKNOWN",
        approvals=tuple(sorted(approvals - {""})),
        checks_pass=checks_pass,
        changed_files=len(item.get("files") or []),
    )


def chain(prs: list[PullRequest]) -> list[PullRequest]:
    """Prefer an explicit base-branch dependency, then stable PR number."""
    remaining = {pr.number: pr for pr in prs}
    ordered: list[PullRequest] = []
    available = {"master", "main"}
    while remaining:
        candidates = [pr for pr in remaining.values() if pr.base in available]
        if not candidates:
            candidates = list(remaining.values())
        current = min(candidates, key=lambda pr: pr.number)
        ordered.append(current)
        available.add(current.head)
        remaining.pop(current.number)
    return ordered


def print_report(ordered: list[PullRequest]) -> None:
    print("PR chain (read-only; no GitHub mutations):")
    for index, pr in enumerate(ordered, 1):
        missing = [bot for bot in REQUIRED_BOTS if bot not in pr.approvals]
        status = "ELIGIBLE" if pr.gate_ready else "BLOCKED"
        reasons = []
        if pr.draft:
            reasons.append("draft")
        if pr.mergeable != "MERGEABLE":
            reasons.append(f"mergeable={pr.mergeable.lower()}")
        if missing:
            reasons.append("missing=" + ",".join(missing))
        if not pr.checks_pass:
            reasons.append("checks-failing")
        detail = f" ({'; '.join(reasons)})" if reasons else ""
        print(f"{index}. #{pr.number} {pr.base} <- {pr.head}: {status}{detail}")
    next_pr = next((pr for pr in ordered if pr.gate_ready), None)
    print(f"Next eligible PR: #{next_pr.number}" if next_pr else "Next eligible PR: none")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--prs", nargs="*", type=int)
    args = parser.parse_args()
    try:
        ordered = chain(load_prs(args.prs))
    except (RuntimeError, json.JSONDecodeError) as exc:
        print(f"pr-chain: {exc}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps([asdict(pr) | {"gate_ready": pr.gate_ready} for pr in ordered], indent=2))
    else:
        print_report(ordered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
