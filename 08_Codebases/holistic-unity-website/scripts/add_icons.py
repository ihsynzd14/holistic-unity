#!/usr/bin/env python3
"""
add_icons.py — ensure favicon + apple-touch-icon on every page (run on _src).

Only the homepage declared a favicon and no page had an apple-touch-icon (so iOS
"Add to Home Screen" fell back to a blurry screenshot). This inserts, in each
template head: an apple-touch-icon link (and a favicon link on the 43 pages that
lacked one). Absolute paths so they resolve in the /en and /pt subfolder trees.

Idempotent. Run on _src BEFORE prerender.
"""
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "_src")

FAV = '<link rel="icon" type="image/png" href="/images/logo.png">'
ATI = '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">'

VIEWPORT_RE = re.compile(r'^([ \t]*)(<meta\s+name="viewport"[^>]*>)', re.MULTILINE | re.IGNORECASE)
ICON_RE = re.compile(r'^([ \t]*)(<link[^>]*\brel="icon"[^>]*>)', re.MULTILINE | re.IGNORECASE)


def main():
    files = glob.glob(os.path.join(SRC, "*.html")) + glob.glob(os.path.join(SRC, "blog", "*.html"))
    changed = 0
    for f in files:
        text = open(f, encoding="utf-8").read()
        if "apple-touch-icon" in text:
            continue  # idempotent
        m_icon = ICON_RE.search(text)
        if m_icon:
            indent = m_icon.group(1)
            text = ICON_RE.sub(lambda mm: f"{mm.group(0)}\n{indent}{ATI}", text, count=1)
        else:
            m_vp = VIEWPORT_RE.search(text)
            if not m_vp:
                print(f"  !! no anchor in {os.path.relpath(f, ROOT)} — skipped")
                continue
            indent = m_vp.group(1)
            text = VIEWPORT_RE.sub(
                lambda mm: f"{mm.group(0)}\n{indent}{FAV}\n{indent}{ATI}", text, count=1)
        with open(f, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
        changed += 1
    print(f"icons added to {changed} templates")


if __name__ == "__main__":
    main()
