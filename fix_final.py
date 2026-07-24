import glob

files = glob.glob("src/**/*.ts", recursive=True)
for fpath in sorted(files):
    with open(fpath, "r", encoding="utf-8") as f:
        content = f.read()

    original = content

    # Replace box drawing ─ with -
    content = content.replace("\u2500", "-")

    # Replace ± with +/-
    content = content.replace("\u00b1", "+/-")

    if content != original:
        with open(fpath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Fixed: {fpath}")

print("Done")
