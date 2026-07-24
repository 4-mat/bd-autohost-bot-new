import glob, re

files = glob.glob("src/**/*.ts", recursive=True)
for fpath in sorted(files):
    with open(fpath, "rb") as f:
        raw = f.read()

    original = raw

    # Remove BOM
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]

    # The mojibake pattern: original UTF-8 bytes interpreted as cp1252, then re-encoded as UTF-8.
    # Pattern: C3 A2 E2 80 9D E2 82 AC = â€" which is cp1252 interpretation of E2 94 80 = ─
    # Replace: the 6-byte sequence with the original 3-byte sequence
    raw = raw.replace(b"\xc3\xa2\xe2\x80\x9d\xe2\x82\xac", b"\xe2\x94\x80")  # ─

    # Pattern: C3 A2 E2 82 AC E2 80 9D = â€" reversed order
    raw = raw.replace(b"\xc3\xa2\xe2\x82\xac\xe2\x80\x9d", b"\xe2\x94\x80")  # ─

    # Em dash: C3 A2 E2 80 94 = â" (cp1252: E2 80 94)... let me check
    # Actually, — (U+2014) in UTF-8 is E2 80 94
    # In cp1252: 0x94 = " (U+201D)... no that's different
    # Let me check: the raw for em dash would be E2 80 94
    # If interpreted as cp1252: E2=â, 80=€, 94="
    # So cp1252 text: â€"
    # Then UTF-8 encoded: C3 A2 E2 80 AC E2 80 9D
    raw = raw.replace(b"\xc3\xa2\xe2\x80\xac\xe2\x80\x9d", b"\xe2\x80\x94")  # —

    # Check if there are any remaining high bytes (excluding expected ones like UTF-8 BOM)
    remaining = set()
    for i, b in enumerate(raw):
        if b > 127:
            remaining.add(b)

    if raw != original:
        with open(fpath, "wb") as f:
            f.write(raw)
        print(
            f"Fixed: {fpath} (remaining high bytes: {sorted(hex(b) for b in remaining)})"
        )
    elif remaining:
        print(f"High bytes in {fpath}: {sorted(hex(b) for b in remaining)}")

print("Done")
