#!/usr/bin/env python3
"""Ad-hoc tests for the complexity parser (CodeRabbit finding verification).

Run: python3 scripts/test_parse_complexity.py
"""

import os

# The module filename uses a hyphen, which can't be `import`ed directly, so
# exec its source and pull out the `parse` function.
_HERE = os.path.dirname(os.path.abspath(__file__))
_NS = {}
with open(os.path.join(_HERE, "_parse-complexity.py"), encoding="utf-8") as _f:
    exec(compile(_f.read(), "_parse-complexity.py", "exec"), _NS)
parse = _NS["parse"]


def check(label, raw, expected):
    got = parse(raw)
    got_norm = sorted((c, f, ln, n) for c, f, ln, n in got)
    exp_norm = sorted((c, f, ln, n) for c, f, ln, n in expected)
    if got_norm != exp_norm:
        raise AssertionError(
            f"[{label}] FAILED\n  expected={exp_norm}\n  got     ={got_norm}"
        )
    print(f"[{label}] OK -> {got_norm}")


# 1. CodeRabbit's exact example: method diagnostic in the two-line "!" format.
check(
    "two-line method (CodeRabbit example)",
    (
        "  ! eslint(complexity): method `resolveTurn` has a complexity of 16.\n"
        "     ,-[src/game/resolve.ts:123:5]\n"
    ),
    [(16, "src/game/resolve.ts", 123, "resolveTurn")],
)

# 2. Single-line piped format with a method.
check(
    "single-line method",
    (
        "src/game/hot.ts:2:10: warning eslint(complexity): method `compute` "
        "has a complexity of 19. Maximum allowed is 15.\n"
    ),
    [(19, "src/game/hot.ts", 2, "compute")],
)

# 3. class static block (both layouts).
check(
    "single-line class static block",
    (
        "src/game/statics.ts:2:3: warning eslint(complexity): class static "
        "block has a complexity of 16. Maximum allowed is 15.\n"
    ),
    [(16, "src/game/statics.ts", 2, "<anonymous>")],
)
check(
    "two-line class static block",
    (
        "  ! eslint(complexity): class static block has a complexity of 16.\n"
        "     ,-[src/game/statics.ts:2:3]\n"
    ),
    [(16, "src/game/statics.ts", 2, "<anonymous>")],
)

# 4. Multi-kind single-line (mixed subjects), sorted desc.
check(
    "multi-kind single-line",
    (
        "src/game/a.ts:1:1: warning eslint(complexity): function `foo` has a "
        "complexity of 22. Maximum allowed is 15.\n"
        "src/game/b.ts:2:2: warning eslint(complexity): method `bar` has a "
        "complexity of 18. Maximum allowed is 15.\n"
        "src/game/c.ts:3:3: warning eslint(complexity): generator function "
        "`gen` has a complexity of 13. Maximum allowed is 15.\n"
        "src/game/d.ts:4:4: warning eslint(complexity): async function `af` "
        "has a complexity of 12. Maximum allowed is 15.\n"
        "src/game/e.ts:5:5: warning eslint(complexity): arrow function `afn` "
        "has a complexity of 10. Maximum allowed is 15.\n"
        "src/game/f.ts:6:6: warning eslint(complexity): class field "
        "initializer has a complexity of 9. Maximum allowed is 15.\n"
        "src/game/g.ts:7:7: warning eslint(complexity): Constructor `ctor` "
        "has a complexity of 5. Maximum allowed is 15.\n"
    ),
    [
        (22, "src/game/a.ts", 1, "foo"),
        (18, "src/game/b.ts", 2, "bar"),
        (13, "src/game/c.ts", 3, "gen"),
        (12, "src/game/d.ts", 4, "af"),
        (10, "src/game/e.ts", 5, "afn"),
        (9, "src/game/f.ts", 6, "<anonymous>"),
        (5, "src/game/g.ts", 7, "ctor"),
    ],
)

# 5. Anonymous function (no backtick name) still works.
check(
    "anonymous function",
    (
        "  ! eslint(complexity): function has a complexity of 20.\n"
        "     ,-[src/game/f.ts:6:6]\n"
    ),
    [(20, "src/game/f.ts", 6, "<anonymous>")],
)

# 6. Non-complexity lines are ignored.
check(
    "ignores unrelated lines",
    (
        "    : warning eslint(no-unused-vars): Function `foo` is declared "
        "but never used.\n"
        "  ! eslint(complexity): function `onlyOne` has a complexity of 7.\n"
        "     ,-[src/game/x.ts:1:1]\n"
    ),
    [(7, "src/game/x.ts", 1, "onlyOne")],
)

print("\nAll parser tests passed.")
