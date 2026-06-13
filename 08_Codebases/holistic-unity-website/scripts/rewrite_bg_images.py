#!/usr/bin/env python3
"""
rewrite_bg_images.py — optimize CSS background-image hero art (S2 gap, run on _src)

Some hero <section>s set the category illustration via an inline
`background-image: url('images/categories/X.png')` (1.3-1.6 MB PNG) instead of
an <img>, so the <picture> rewriter never touched them. CSS can't use <picture>,
so we swap to image-set(): WebP for modern browsers, optimized JPG fallback —
both ~90% smaller. Paths are made ROOT-absolute (/images/…) so they also resolve
in the /en and /pt subfolder trees.

Idempotent. Run on _src BEFORE prerender.
"""
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "_src")

# background-image: url( 'images/....png' )   (quotes optional, spaces allowed).
# Matches .png only: the heavy hero backgrounds are all PNG, and after conversion
# the style references .jpg/.webp — so re-running this is a no-op (idempotent).
BG_RE = re.compile(
    r"background-image:\s*url\((['\"]?)([^)'\"]+\.png)\1\)",
    re.IGNORECASE)


def root_path(ref):
    ref = re.sub(r"^(?:\.\./)+", "", ref).lstrip("/")
    return os.path.normpath(os.path.join(ROOT, ref))


def main():
    files = glob.glob(os.path.join(SRC, "*.html")) + glob.glob(os.path.join(SRC, "blog", "*.html"))
    changed = 0
    for f in files:
        text = open(f, encoding="utf-8").read()

        def repl(m):
            ref = m.group(2)
            stem = os.path.splitext(ref)[0]            # images/categories/X
            webp = root_path(stem + ".webp")
            jpg = root_path(stem + ".jpg")
            if not (os.path.exists(webp) and os.path.exists(jpg)):
                return m.group(0)                       # no siblings -> leave
            abs_stem = "/" + re.sub(r"^(?:\.\./)+", "", stem).lstrip("/")
            jpg_url = f"{abs_stem}.jpg"
            webp_url = f"{abs_stem}.webp"
            # plain JPG fallback first, then image-set override for modern browsers
            return (f"background-image: url('{jpg_url}'); "
                    f"background-image: image-set("
                    f"url('{webp_url}') type('image/webp'), "
                    f"url('{jpg_url}') type('image/jpeg'))")

        new, n = BG_RE.subn(repl, text)
        # idempotency: if already image-set'd, BG_RE still matches the url() but
        # repl returns an equivalent string; guard by skipping when unchanged.
        if new != text:
            with open(f, "w", encoding="utf-8", newline="") as fh:
                fh.write(new)
            changed += n
            print(f"  {os.path.relpath(f, ROOT)}: {n} background-image -> image-set")
    print(f"\nbackground-image conversions: {changed}")


if __name__ == "__main__":
    main()
