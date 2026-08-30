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

    oxlint can emit complexity diagnostics in two layouts:

    1. The "!" default reporter, where the diagnostic line and the file
       location are on separate lines:
           "  ! eslint(complexity): function `x` has a complexity of 33."
           "     ,-[src/game/resolve.ts:19:3]"

    2. The non-TTY reporter used when piping (e.g. by complexity-scan.sh),
       where the location is embedded in a single line:
           "src/game/resolve.ts:19:3: warning eslint(complexity): "
           "function `x` has a complexity of 33. Maximum allowed is 15."

    Both are handled. The rule reports several node kinds (function, method,
    arrow function, generator/async function, class method, constructor), so
    the diagnostic type is matched generically rather than hard-coding
    "function"; previously a "method `bar` ..." diagnostic was silently
    dropped.
    """
    # Diagnostic subject: one or more lowercase words describing the construct
    # that exceeds the threshold, e.g. "function", "method", "arrow function",
    # "generator function", "async function", "class static block",
    # "class field initializer", "constructor", etc. Matching the whole
    # subject (rather than hard-coding "function") means a "method `x` ..." or
    # "class static block has a complexity of N" diagnostic is no longer
    # silently dropped. The subject is matched case-insensitively so
    # ESLint-style capitalized names ("Method `x` ...") also parse.
    subject_re = r"[a-z]+(?:\s+[a-z]+)*"
    # Matches `<file>:<line>:<col>: warning eslint(complexity): ...` (piped
    # output) with the location captured from the prefix.
    # File pattern handles both Unix paths and Windows paths with drive letters (e.g., C:/path/file.ts).
    inline_re = re.compile(
        r"([^:\s]+(?::[^:\s]+)?):(\d+):\d+:.*eslint\(complexity\):\s+"
        + subject_re
        + r"(?: `([^`]+)`)? has a complexity of (\d+)",
        re.IGNORECASE,
    )
    # Matches the "!" reporter diagnostic line, expecting the file location on
    # the following line (tracked via `pending`).
    message_re = re.compile(
        r".*eslint\(complexity\):\s+"
        + subject_re
        + r"(?: `([^`]+)`)? has a complexity of (\d+)",
        re.IGNORECASE,
    )
    # Location pattern handles both Unix paths and Windows paths with drive letters.
    location_re = re.compile(r"\s*[,-]+\[([^:]+(?::[^:]+)?):(\d+):\d+\]")

    results = []
    pending = None
    for line in raw.splitlines():
        m = inline_re.match(line)
        if m:
            file, line_no, name, complexity = (
                m.group(1),
                m.group(2),
                m.group(3),
                m.group(4),
            )
            results.append((int(complexity), file, int(line_no), name or "<anonymous>"))
            pending = None
            continue
        m = message_re.match(line)
        if m:
            pending = (m.group(1) or "<anonymous>", int(m.group(2)))
            continue
        if pending:
            m = location_re.match(line)
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
