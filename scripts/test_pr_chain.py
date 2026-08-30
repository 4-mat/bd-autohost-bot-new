import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("pr_chain", Path(__file__).with_name("pr-chain.py"))
import sys
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def pr(number, base, head, *, draft=False, mergeable="MERGEABLE", approvals=(), checks=True):
    return module.PullRequest(number, f"PR {number}", base, head, "OPEN", draft, mergeable, tuple(approvals), checks, 1)


def test_chain_follows_branch_bases_before_number():
    ordered = module.chain([
        pr(20, "feature-a", "feature-b"),
        pr(10, "master", "feature-a"),
        pr(30, "master", "feature-c"),
    ])
    assert [item.number for item in ordered] == [10, 20, 30]


def test_gate_requires_both_bots_and_passing_checks():
    ready = pr(1, "master", "feature", approvals=("CodeRabbit", "PR Agent"))
    blocked = pr(2, "master", "feature-2", approvals=("CodeRabbit",), checks=False)
    assert ready.gate_ready
    assert not blocked.gate_ready
