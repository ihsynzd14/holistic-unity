#!/usr/bin/env python3
"""
find_unused_images.py — report (and optionally delete) PNGs no file references.

A PNG is "unused" if its filename appears in NONE of the project's text files
(HTML across root/_src/en/pt/blog/preview, CSS, JS, JSON, XML, and the Python
build scripts — so build-source assets like logo-square.png are kept). Both the
literal name and its %20-encoded form are checked.

  python scripts/find_unused_images.py            # report only (safe)
  python scripts/find_unused_images.py --delete    # delete the unused PNGs
"""
import os
import sys
import glob
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DELETE = "--delete" in sys.argv

# .md is intentionally excluded: a doc *mentioning* an image (e.g. CLAUDE.md
# naming a "style reference") does not make it used by the site.
TEXT_EXT = (".html", ".css", ".js", ".json", ".xml", ".txt", ".py")


def build_corpus():
    parts = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        # skip VCS / vendor noise
        if any(seg in dirpath for seg in (os.sep + ".git", os.sep + "node_modules",
                                          os.sep + ".vercel")):
            continue
        for fn in filenames:
            if fn.lower().endswith(TEXT_EXT):
                try:
                    parts.append(open(os.path.join(dirpath, fn),
                                      encoding="utf-8", errors="ignore").read())
                except Exception:
                    pass
    return "\n".join(parts)


def main():
    corpus = build_corpus()
    pngs = [p for p in glob.glob(os.path.join(ROOT, "**", "*.png"), recursive=True)
            if os.sep + ".git" not in p]
    unused, total_bytes = [], 0
    for p in sorted(pngs):
        base = os.path.basename(p)
        if base in corpus or urllib.parse.quote(base) in corpus:
            continue
        unused.append(p)
        total_bytes += os.path.getsize(p)

    rel = lambda p: os.path.relpath(p, ROOT).replace(os.sep, "/")
    print(f"{'UNUSED' if not DELETE else 'DELETING'} PNGs: {len(unused)} "
          f"({total_bytes/1e6:.1f} MB)\n")
    for p in unused:
        print(f"  {os.path.getsize(p)//1024:>5} KB  {rel(p)}")
        if DELETE:
            os.remove(p)
    print(f"\n{'Deleted' if DELETE else 'Would delete'} {len(unused)} files, "
          f"{total_bytes/1e6:.1f} MB freed."
          + ("" if DELETE else "  Re-run with --delete to remove."))


if __name__ == "__main__":
    main()
