import sys

lines = sys.stdin.read().splitlines()
s = "\n".join(lines) + "\n"
open("src/sheets/state.ts", "w").write(s)
