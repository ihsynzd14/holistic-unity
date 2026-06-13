#!/usr/bin/env python3
"""
rewrite_images_html.py — wire the optimized images into the HTML (S2)

For every <img src="*.png|*.jpg|*.jpeg"> that is NOT already inside a <picture>:
    <picture>
      <source type="image/webp" srcset="<same path>.webp">
      <img ... src="<light fallback>" ...>
    </picture>

  - WebP srcset spaces are URL-encoded (srcset is whitespace-delimited).
  - For heavy category PNGs that now have a .jpg sibling, the <img> fallback
    src is switched .png -> .jpg (so even the fallback path is light, and the
    1.5 MB PNG is no longer referenced anywhere).

Also repoints og:image / twitter:image .png -> .jpg wherever a .jpg sibling
exists (this fixes the MISSING homepage og-image.png / twitter-image.png by
pointing them at the freshly generated og-image.jpg / twitter-image.jpg).

Idempotent: re-running makes no further changes.

Usage:
  python scripts/rewrite_images_html.py --dry-run            # report only
  python scripts/rewrite_images_html.py --only reiki.html    # one file
  python scripts/rewrite_images_html.py                      # apply to all
"""
import os
import re
import sys
import glob
from urllib.parse import unquote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRY = "--dry-run" in sys.argv
ONLY = None
if "--only" in sys.argv:
    ONLY = sys.argv[sys.argv.index("--only") + 1]

RASTER_RE = re.compile(r"\.(png|jpe?g)$", re.IGNORECASE)
IMG_RE = re.compile(r"<img\b[^>]*?>", re.IGNORECASE)
SRC_RE = re.compile(r'\bsrc\s*=\s*"([^"]+)"', re.IGNORECASE)
PICTURE_RE = re.compile(r"<picture\b.*?</picture>", re.IGNORECASE | re.DOTALL)
OG_RE = re.compile(
    r'(<meta\b[^>]*\b(?:property|name)\s*=\s*"(?:og:image|twitter:image)"[^>]*\bcontent\s*=\s*")([^"]+)(")',
    re.IGNORECASE,
)

SITE_HOST = "holisticunity.app"


def disk_path_for(html_file, src):
    """Resolve an <img>/meta src to an on-disk path (handles %20, abs URLs, leading /)."""
    s = unquote(src)
    if s.startswith("http"):
        # strip scheme://host
        s = re.sub(r"^https?://[^/]+/", "", s)
        base = ROOT
    elif s.startswith("/"):
        s = s.lstrip("/")
        base = ROOT
    else:
        base = os.path.dirname(html_file)
    return os.path.normpath(os.path.join(base, s))


def sibling(src, new_ext):
    """Return src string with its extension swapped, preserving %20 vs space form."""
    return RASTER_RE.sub(new_ext, src)


def to_srcset(path_str):
    """WebP path for srcset: swap ext, URL-encode spaces (srcset is ws-delimited)."""
    return sibling(path_str, ".webp").replace(" ", "%20")


def has_jpg_sibling(html_file, src):
    return os.path.exists(disk_path_for(html_file, sibling(src, ".jpg")))


def has_webp_sibling(html_file, src):
    return os.path.exists(disk_path_for(html_file, sibling(src, ".webp")))


def wrap_images(html, html_file, stats):
    # regions already inside <picture> -> leave alone (idempotency)
    picture_spans = [(m.start(), m.end()) for m in PICTURE_RE.finditer(html)]

    def in_picture(pos):
        return any(a <= pos < b for a, b in picture_spans)

    out = []
    last = 0
    for m in IMG_RE.finditer(html):
        if in_picture(m.start()):
            continue
        tag = m.group(0)
        sm = SRC_RE.search(tag)
        if not sm:
            continue
        src = sm.group(1)
        if not RASTER_RE.search(src):
            continue  # svg/gif/data/etc.
        if not has_webp_sibling(html_file, src):
            stats["skipped_no_webp"] += 1
            continue

        new_tag = tag
        # light fallback: png -> jpg when a jpg sibling exists
        if src.lower().endswith(".png") and has_jpg_sibling(html_file, src):
            new_tag = tag.replace(src, sibling(src, ".jpg"))
        srcset = to_srcset(src)

        # preserve the leading indentation of the <img> line for the <source>
        line_start = html.rfind("\n", 0, m.start()) + 1
        indent = re.match(r"[ \t]*", html[line_start:m.start()]).group(0)

        replacement = (
            f"<picture><source type=\"image/webp\" srcset=\"{srcset}\">"
            f"{new_tag}</picture>"
        )
        out.append(html[last:m.start()])
        out.append(replacement)
        last = m.end()
        stats["wrapped"] += 1
    out.append(html[last:])
    return "".join(out)


def repoint_og(html, html_file, stats):
    def repl(m):
        pre, url, post = m.group(1), m.group(2), m.group(3)
        if url.lower().endswith(".png") and has_jpg_sibling(html_file, url):
            stats["og_repointed"] += 1
            return pre + sibling(url, ".jpg") + post
        return m.group(0)
    return OG_RE.sub(repl, html)


def main():
    files = sorted(glob.glob(os.path.join(ROOT, "*.html")) +
                   glob.glob(os.path.join(ROOT, "blog", "*.html")))
    # skip backups / preview / dashboards that aren't part of the live indexable site
    skip = ("index.html.backup", "dashboard_1mag", "1e88c1c8")
    files = [f for f in files if not any(s in os.path.basename(f) for s in skip)]
    if ONLY:
        files = [f for f in files if os.path.basename(f) == ONLY]

    grand = {"wrapped": 0, "og_repointed": 0, "skipped_no_webp": 0, "files": 0}
    for f in files:
        with open(f, "r", encoding="utf-8") as fh:
            html = fh.read()
        stats = {"wrapped": 0, "og_repointed": 0, "skipped_no_webp": 0}
        new = wrap_images(html, f, stats)
        new = repoint_og(new, f, stats)
        if new != html:
            grand["files"] += 1
            if not DRY:
                with open(f, "w", encoding="utf-8", newline="") as fh:
                    fh.write(new)
        if stats["wrapped"] or stats["og_repointed"] or stats["skipped_no_webp"]:
            print(f"  {os.path.relpath(f, ROOT):45} "
                  f"wrap={stats['wrapped']:>3} og={stats['og_repointed']:>2} "
                  f"skip={stats['skipped_no_webp']:>2}")
        for k in stats:
            grand[k] += stats[k]

    print(f"\n{'DRY-RUN — ' if DRY else ''}files changed: {grand['files']} | "
          f"imgs wrapped: {grand['wrapped']} | og repointed: {grand['og_repointed']} | "
          f"skipped (no webp): {grand['skipped_no_webp']}")


if __name__ == "__main__":
    main()
