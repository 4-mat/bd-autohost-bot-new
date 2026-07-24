import glob

files = glob.glob("src/**/*.ts", recursive=True)
for fpath in sorted(files):
    with open(fpath, "rb") as f:
        raw = f.read()

    # Check if it has double-encoded UTF-8 (mojibake from cp1252 misinterpretation)
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        continue

    # Check for mojibake pattern: cp1252 chars that were re-encoded as UTF-8
    has_mojibake = False
    for c in text:
        cp = ord(c)
        # cp1252 range: chars above 127 that are NOT valid in cp1252 when re-encoded
        # The mojibake shows up as chars like â, €, etc. that shouldn't be in code comments
        if cp in (0x20AC, 0x201C, 0x201D, 0x2018, 0x2019, 0x2013, 0x2014):
            has_mojibake = True
            break

    if has_mojibake:
        try:
            # Encode text back to cp1252, then decode as UTF-8
            fixed = text.encode("cp1252").decode("utf-8")
            if fixed != text:
                with open(fpath, "w", encoding="utf-8") as f:
                    f.write(fixed)
                print(f"Fixed: {fpath}")
                continue
        except (UnicodeDecodeError, UnicodeEncodeError):
            pass

    # Check remaining non-ASCII
    remaining = set()
    for c in text:
        if ord(c) > 127:
            remaining.add(hex(ord(c)))
    if remaining:
        print(f"Remaining non-ASCII in {fpath}: {remaining}")

print("Done")
