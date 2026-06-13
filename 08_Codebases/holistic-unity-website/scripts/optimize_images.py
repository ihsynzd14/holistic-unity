#!/usr/bin/env python3
"""
optimize_images.py — Holistic Unity image optimizer (S2)

Generates modern, lightweight image variants WITHOUT deleting any originals
(so the change is fully reversible):

  1. A `.webp` sibling for every raster image  -> primary, served to ~97% of
     browsers via <picture><source type="image/webp">.
  2. An optimized `.jpg` sibling for heavy OPAQUE PNGs (the category
     illustrations etc.) -> used as the <img> fallback AND as the og:image,
     replacing the 1.3-1.6 MB PNGs that social scrapers + old browsers fetch.
  3. Brand `og-image.jpg` + `twitter-image.jpg` (1200x630) -- the homepage
     references og-image.png / twitter-image.png which DO NOT EXIST on disk.

Quality / sizing:
  - Longest side capped at MAX_SIDE (only oversized sources are downscaled;
     the 1280x720 category art is kept at native size for OG compatibility).
  - WebP quality 80, method 6 (alpha preserved for RGBA sources).
  - JPEG quality 84, progressive, optimized.

Run from the site root:  python scripts/optimize_images.py
Add --force to regenerate variants that already exist.
"""
import os
import sys
import glob
from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES_DIR = os.path.join(ROOT, "images")
# The live homepage (index.html) also references images that physically live
# under these preview folders, so they must be optimized too even though the
# preview *pages* are robots-disallowed.
EXTRA_IMAGE_DIRS = [
    os.path.join(ROOT, "preview-redesign", "images"),
    os.path.join(ROOT, "preview-live-style", "images"),
]

MAX_SIDE = 1600          # cap longest side; category art (1280) is untouched
WEBP_QUALITY = 80
JPEG_QUALITY = 84
# Opaque PNGs at/above this size also get a light .jpg fallback sibling.
HEAVY_PNG_BYTES = 250_000

FORCE = "--force" in sys.argv

RASTER_EXT = (".png", ".jpg", ".jpeg")


def human(n):
    for unit in ("B", "KB", "MB"):
        if n < 1024 or unit == "MB":
            return f"{n:.0f}{unit}" if unit == "B" else f"{n/1024:.0f}{unit}" if unit == "KB" else f"{n/1024/1024:.2f}MB"
        n /= 1024
    return f"{n}"


def load(path):
    im = Image.open(path)
    im = ImageOps.exif_transpose(im)  # respect orientation
    return im


def maybe_downscale(im):
    w, h = im.size
    longest = max(w, h)
    if longest > MAX_SIDE:
        scale = MAX_SIDE / longest
        im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    return im


def save_webp(im, dest):
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        im.save(dest, "WEBP", quality=WEBP_QUALITY, method=6)
    else:
        im.convert("RGB").save(dest, "WEBP", quality=WEBP_QUALITY, method=6)


def save_jpg(im, dest):
    bg = Image.new("RGB", im.size, (253, 246, 240))  # cream, in case of alpha
    if im.mode in ("RGBA", "LA", "P"):
        rgba = im.convert("RGBA")
        bg.paste(rgba, mask=rgba.split()[-1])
        out = bg
    else:
        out = im.convert("RGB")
    out.save(dest, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)


def is_opaque(im):
    if im.mode in ("RGBA", "LA"):
        alpha = im.convert("RGBA").split()[-1]
        return alpha.getextrema()[0] == 255  # min alpha == 255 -> fully opaque
    return im.mode in ("RGB", "L", "P") and im.mode != "P"


def main():
    rasters = []
    for d in [IMAGES_DIR] + EXTRA_IMAGE_DIRS:
        if os.path.isdir(d):
            rasters += [
                p for p in glob.glob(os.path.join(d, "**", "*"), recursive=True)
                if os.path.isfile(p) and p.lower().endswith(RASTER_EXT)
            ]
    rasters = sorted(set(rasters))

    made_webp = made_jpg = 0
    before_total = after_webp_total = 0
    report = []

    for src in rasters:
        src_bytes = os.path.getsize(src)
        before_total += src_bytes
        stem, _ = os.path.splitext(src)

        # --- WebP (always) ---
        webp_dest = stem + ".webp"
        if FORCE or not os.path.exists(webp_dest):
            try:
                im = maybe_downscale(load(src))
                save_webp(im, webp_dest)
                made_webp += 1
            except Exception as e:
                print(f"  ! webp FAILED {src}: {e}")
        if os.path.exists(webp_dest):
            after_webp_total += os.path.getsize(webp_dest)

        # --- JPEG fallback for heavy opaque PNGs (for OG + <img> fallback) ---
        if src.lower().endswith(".png") and src_bytes >= HEAVY_PNG_BYTES:
            try:
                im = load(src)
                if is_opaque(im):
                    jpg_dest = stem + ".jpg"
                    if FORCE or not os.path.exists(jpg_dest):
                        save_jpg(maybe_downscale(im), jpg_dest)
                        made_jpg += 1
                    rel = os.path.relpath(jpg_dest, ROOT).replace("\\", "/")
                    report.append(
                        (src_bytes, os.path.getsize(jpg_dest),
                         os.path.getsize(webp_dest) if os.path.exists(webp_dest) else 0,
                         rel))
            except Exception as e:
                print(f"  ! jpg FAILED {src}: {e}")

    # --- Brand OG / Twitter images (homepage references them but they're missing) ---
    make_brand_og()

    # ---- report ----
    print("\n=== Heavy PNG -> JPG/WebP savings (top sources) ===")
    print(f"{'PNG':>9} {'JPG':>9} {'WEBP':>9}  PATH")
    for png_b, jpg_b, webp_b, rel in sorted(report, reverse=True):
        print(f"{human(png_b):>9} {human(jpg_b):>9} {human(webp_b):>9}  {rel}")

    print(f"\nGenerated: {made_webp} .webp, {made_jpg} .jpg fallbacks")
    print(f"All raster originals total: {human(before_total)}")
    print(f"All .webp total:            {human(after_webp_total)}  "
          f"({100*after_webp_total/before_total:.0f}% of originals)")


def make_brand_og():
    """Create images/og-image.jpg + twitter-image.jpg (1200x630) on brand cream
    with the centered logo. Homepage meta references the .png names which are
    absent; the HTML rewriter repoints them to these optimized .jpg files."""
    logo_candidates = [
        os.path.join(IMAGES_DIR, "logo-square.png"),
        os.path.join(IMAGES_DIR, "logo.png"),
        os.path.join(ROOT, "logo.png"),
    ]
    logo_path = next((p for p in logo_candidates if os.path.exists(p)), None)
    W, H = 1200, 630
    canvas = Image.new("RGB", (W, H), (253, 246, 240))  # --cream
    if logo_path:
        logo = load(logo_path).convert("RGBA")
        target_h = 300
        scale = target_h / logo.height
        logo = logo.resize((round(logo.width * scale), target_h), Image.LANCZOS)
        x = (W - logo.width) // 2
        y = (H - logo.height) // 2
        canvas.paste(logo, (x, y), mask=logo.split()[-1])
    for name in ("og-image.jpg", "twitter-image.jpg"):
        dest = os.path.join(IMAGES_DIR, name)
        if FORCE or not os.path.exists(dest):
            canvas.save(dest, "JPEG", quality=88, optimize=True, progressive=True)
            print(f"  + brand social image: images/{name}")

    # Apple touch icon: 180x180, OPAQUE (iOS renders transparency as black) at
    # the site root so iOS/Safari "Add to Home Screen" shows a clean icon.
    ati = os.path.join(ROOT, "apple-touch-icon.png")
    if (FORCE or not os.path.exists(ati)) and logo_path:
        src = load(logo_path).convert("RGBA")
        icon = Image.new("RGB", (180, 180), (253, 246, 240))  # cream backdrop
        if abs(src.width - src.height) <= 2:          # already square -> fill
            sq = src.resize((180, 180), Image.LANCZOS)
            icon.paste(sq, (0, 0), mask=sq.split()[-1])
        else:                                          # letterbox + center
            src.thumbnail((180, 180), Image.LANCZOS)
            icon.paste(src, ((180 - src.width) // 2, (180 - src.height) // 2),
                       mask=src.split()[-1])
        icon.save(ati, "PNG", optimize=True)
        print("  + apple-touch-icon.png (180x180) at site root")


if __name__ == "__main__":
    main()
