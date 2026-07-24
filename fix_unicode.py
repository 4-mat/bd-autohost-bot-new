import os, re, glob

files = glob.glob("src/**/*.ts", recursive=True)
for fpath in sorted(files):
    with open(fpath, "r", encoding="utf-8") as f:
        content = f.read()

    original = content

    # Fix mojibake: garbled box-drawing chars (double-encoded UTF-8)
    # Pattern: sequences starting with \xe2 that represent broken unicode
    content = re.sub(r'â€"', "--", content)
    content = re.sub(r'â€"', "--", content)
    content = re.sub(r'â"€', "--", content)

    # Em dash
    content = content.replace("\u2014", "--")

    # Arrows
    content = content.replace("\u2192", "->")  # →
    content = content.replace("\u25b6", "")  # ▶
    content = content.replace("\u25c0", "")  # ◀

    # Multiplication sign
    content = content.replace("\u00d7", "x")  # ×

    # Emoji
    content = content.replace("\U0001f3b2", "[roll]")  # 🎲
    content = content.replace("\U0001f3c6", "[WIN]")  # 🏆
    content = content.replace("\U0001f7e2", "[+]")  # 🟢
    content = content.replace("\U0001f7e1", "[~]")  # 🟡
    content = content.replace("\U0001f534", "[-]")  # 🔴

    # Clean up runs of dashes: replace 40+ dashes with 40 dashes
    content = re.sub(r"-{41,}", "----------------------------------------", content)

    if content != original:
        with open(fpath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Fixed: {fpath}")

print("Done")
