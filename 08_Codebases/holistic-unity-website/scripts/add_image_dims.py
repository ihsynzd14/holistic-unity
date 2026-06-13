#!/usr/bin/env python3
"""
add_image_dims.py — CLS / LCP image attributes (Tier A6), run on _src/

For every <img> in the templates:
  - add intrinsic width/height (from the real file) when missing  -> kills CLS
  - add decoding="async" to non-hero images
  - LCP hero (first image in a hero container) -> fetchpriority="high" + eager
  - other below-the-fold images missing loading -> loading="lazy"
    (nav logos are left eager so the masthead paints immediately)

Idempotent and formatting-preserving (targeted regex per <img>, no reserialize).
Run on _src BEFORE prerender so the attributes bake into all language outputs.
"""
import os
import re
import glob
from urllib.parse import unquote
from PIL import Image
from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "_src")

HERO_SELECTORS = [".page-hero-image img", ".hero-photo img", ".hero-visual img",
                  ".article-hero img", ".hero-image img", ".app-visual img"]

IMG_RE = re.compile(r"<img\b[^>]*?>", re.IGNORECASE)
SRC_RE = re.compile(r'\bsrc\s*=\s*"([^"]+)"', re.IGNORECASE)

_dim_cache = {}


def measure(src):
    """Resolve an _src-relative img src to the real file at ROOT and read size."""
    s = unquote(src)
    s = re.sub(r"^(?:\.\./)+", "", s).lstrip("/")
    path = os.path.normpath(os.path.join(ROOT, s))
    if path in _dim_cache:
        return _dim_cache[path]
    dims = None
    if os.path.exists(path):
        try:
            with Image.open(path) as im:
                dims = im.size
        except Exception:
            dims = None
    _dim_cache[path] = dims
    return dims


def has_attr(tag, name):
    return re.search(r"\b" + name + r"\s*=", tag, re.IGNORECASE) is not None


def inject(tag, additions):
    """Insert ` k="v"` pairs just before the tag's closing > (handles /> and >)."""
    if not additions:
        return tag
    add = "".join(f' {k}="{v}"' for k, v in additions.items())
    if tag.rstrip().endswith("/>"):
        return tag[:tag.rstrip().rfind("/>")] + add + " />"
    return tag[:tag.rstrip().rfind(">")] + add + ">"


def set_loading_eager(tag):
    if re.search(r'\bloading\s*=\s*"lazy"', tag, re.IGNORECASE):
        return re.sub(r'\bloading\s*=\s*"lazy"', 'loading="eager"', tag, flags=re.IGNORECASE)
    if not has_attr(tag, "loading"):
        return inject(tag, {"loading": "eager"})
    return tag


def process_file(path):
    text = open(path, encoding="utf-8").read()
    soup = BeautifulSoup(text, "html.parser")
    hero = None
    for sel in HERO_SELECTORS:
        hero = soup.select_one(sel)
        if hero is not None:
            break
    hero_src = hero.get("src") if hero is not None else None
    hero_done = {"v": False}
    counts = {"dims": 0, "lazy": 0, "fp": 0, "dec": 0}

    def repl(m):
        tag = m.group(0)
        sm = SRC_RE.search(tag)
        if not sm:
            return tag
        src = sm.group(1)
        is_logo = "logo" in src.lower()
        is_hero = (hero_src is not None and src == hero_src and not hero_done["v"])
        adds = {}

        if not has_attr(tag, "width"):
            dims = measure(src)
            if dims:
                adds["width"], adds["height"] = dims[0], dims[1]
                counts["dims"] += 1

        if is_hero:
            hero_done["v"] = True
            if not has_attr(tag, "fetchpriority"):
                adds["fetchpriority"] = "high"
                counts["fp"] += 1
            tag = set_loading_eager(tag)
        else:
            if not has_attr(tag, "decoding"):
                adds["decoding"] = "async"
                counts["dec"] += 1
            if not has_attr(tag, "loading") and not is_logo:
                adds["loading"] = "lazy"
                counts["lazy"] += 1

        return inject(tag, adds)

    new = IMG_RE.sub(repl, text)
    if new != text:
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(new)
    return counts


def main():
    files = sorted(glob.glob(os.path.join(SRC, "*.html")) +
                   glob.glob(os.path.join(SRC, "blog", "*.html")))
    tot = {"dims": 0, "lazy": 0, "fp": 0, "dec": 0}
    for f in files:
        c = process_file(f)
        for k in tot:
            tot[k] += c[k]
    print(f"A6 applied across {len(files)} templates: "
          f"+{tot['dims']} width/height, +{tot['lazy']} loading=lazy, "
          f"+{tot['fp']} hero fetchpriority, +{tot['dec']} decoding=async")


if __name__ == "__main__":
    main()
