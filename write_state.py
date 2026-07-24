import base64, sys

d = base64.b64decode(sys.argv[1])
open("src/sheets/state.ts", "wb").write(d)
