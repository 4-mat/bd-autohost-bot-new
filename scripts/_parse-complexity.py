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
    if pending:
        sys.stderr.write(
            f"warning: unmatched complexity entry {pending!r} without location\n"
        )
    return results


def main() -> None:
    if len(sys.argv) < 2:
        sys.stderr.write(f"usage: {sys.argv[0]} <raw-output-file>\n")
        sys.exit(2)
    raw_path = sys.argv[1]
    try:
        with open(raw_path, encoding="utf-8", errors="replace") as f:
            raw = f.read()
    except OSError as e:
        sys.stderr.write(f"error reading {raw_path}: {e}\n")
        sys.exit(1)

    mode = os.environ.get("MODE_ENV", "text")
    top_env = os.environ.get("TOP_ENV", "")
    top = None
    if top_env:
        try:
            top = int(top_env)
        except ValueError:
            sys.stderr.write(
                f"warning: TOP_ENV={top_env!r} is not an integer, ignoring\n"
            )

    results = parse(raw)
    results.sort(reverse=True, key=lambda r: r[0])
    if top:
        results = results[:top]

    if mode == "json":
        print(
            json.dumps(
                [
                    {"complexity": c, "file": filepath, "line": ln, "name": n}
                    for c, filepath, ln, n in results
                ],
                indent=2,
            )
        )
        return

    total = len(results)
    print(f"\nWarning: {total} function(s) over complexity threshold:\n")
    for c, filepath, ln, n in results:
        print(f"  {c:>3}  {filepath}:{ln}  `{n}`")
    print()


if __name__ == "__main__":
    main()
