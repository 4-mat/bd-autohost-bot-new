"""Parse oxlint complexity diagnostics into a sorted report.

Input: path to a file containing raw oxlint output (with file locations).
Output: text or JSON report of functions over the complexity threshold.
"""

import json
import os
import re
import sys


def parse(raw: str):
    """Pair each complexity diagnostic with its file location.

    oxlint emits the diagnostic line first, then the file location:
        "  ! eslint(complexity): function `x` has a complexity of 33."
        "     ,-[src/game/resolve.ts:19:3]"
    """
    results = []
    pending = None
    for line in raw.splitlines():
        m = re.match(
            r".*eslint\(complexity\):\s+(?:async )?(?:generator )?"
            r"function(?: `([^`]+)`)? has a complexity of (\d+)",
            line,
        )
        if m:
            pending = (m.group(1) or "<anonymous>", int(m.group(2)))
            continue
        if pending:
            m = re.match(r"\s*[,-]+\[([^:]+):(\d+):\d+\]", line)
            if m:
                name, complexity = pending
                results.append((complexity, m.group(1), int(m.group(2)), name))
                pending = None
    return results


def main() -> None:
    raw_path = sys.argv[1]
    with open(raw_path, encoding="utf-8", errors="replace") as f:
        raw = f.read()

    mode = os.environ.get("MODE_ENV", "text")
    top_env = os.environ.get("TOP_ENV", "")
    top = int(top_env) if top_env else None

    results = parse(raw)
    results.sort(reverse=True, key=lambda r: r[0])
    if top:
        results = results[:top]

    if mode == "json":
        print(
            json.dumps(
                [
                    {"complexity": c, "file": f, "line": ln, "name": n}
                    for c, f, ln, n in results
                ],
                indent=2,
            )
        )
        return

    total = len(results)
    print(f"\nWarning: {total} function(s) over complexity threshold:\n")
    for c, f, ln, n in results:
        print(f"  {c:>3}  {f}:{ln}  `{n}`")
    print()


if __name__ == "__main__":
    main()
