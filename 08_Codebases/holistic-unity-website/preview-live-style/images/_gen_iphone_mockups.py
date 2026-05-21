"""
Generate 3D photoreal iPhone mockups, tighter framing + transparent background.

Pipeline:
1. For `mockup-home`: first run nano-banana-pro/edit on the source home screenshot
   to replace the empty state with a "Next session" card — output app-home-next.png.
2. For each of the 3 mockups: run nano-banana-pro/edit with the (possibly edited)
   screenshot to produce a 3D iPhone render on a pure WHITE background.
3. Post-process each PNG with PIL flood-fill from the corners to make the
   background transparent, preserving shadows and phone highlights.

Output files:
  app-home-next.png      (edited source — Next session state)
  mockup-home.png        (transparent 3D iPhone of home-next)
  mockup-browse.png      (transparent 3D iPhone of browse)
  mockup-bookings.png    (transparent 3D iPhone of bookings)
"""
import os, sys, fal_client, urllib.request, time, pathlib
from PIL import Image, ImageDraw
from collections import deque

OUT = pathlib.Path(__file__).parent
PREVIEW_IMGS = pathlib.Path(__file__).parent.parent.parent / "preview-redesign" / "images"

# ─── Step A: edit the home screenshot ──────────────────────────────────────
HOME_SRC = PREVIEW_IMGS / "app-home-v2.png"
HOME_EDIT_OUT = OUT / "app-home-next.png"

HOME_EDIT_PROMPT = (
    "Edit ONLY the card labeled 'Upcoming Sessions' in the middle of the screen. "
    "Currently it contains an illustration of a pink armchair with the text 'No upcoming sessions' "
    "and a magenta pill button 'Book Your First Session'. "
    "REPLACE the entire content of that card with a compact 'Next session' summary that shows: "
    "• a small circular avatar of an Italian woman in her 40s with shoulder-length dark-brown wavy hair, "
    "warm olive skin, soft natural makeup, calm slight smile, wearing a dusty-plum linen blouse "
    "(like a friendly therapist headshot); "
    "• to the right of the avatar, the name 'Chiara Rossi' in bold dark text on the first line, "
    "and the label 'ThetaHealing' in a small magenta tag below the name; "
    "• below, a clear date block: 'Mer 3 Giu · 10:30' with a small calendar icon; "
    "• at the bottom of the card, a full-width rounded magenta button with white text 'Join Session' "
    "and a small video icon on the left. "
    "Keep the rest of the screenshot PIXEL-PERFECT identical to the original: the header "
    "('APRIL 24 — Holistic Unity', 'GOOD MORNING, MARCELLO', 'Return to your own centre.'), "
    "the 'Choose The Best Therapy' section with its ThetaHealing and Family Constellation grid tiles, "
    "and the bottom tab bar. Match the exact visual language: rounded cards with soft shadow, "
    "magenta accent color, serif display font for headings, Inter for body. "
    "Output must look like a real iPhone screenshot, not an illustration."
)

# ─── Step B: 3D iPhone render from each screenshot ──────────────────────────
MOCKUP_SOURCES = {
    "mockup-home":     HOME_EDIT_OUT,
    "mockup-browse":   PREVIEW_IMGS / "app-browse-v2.png",
    "mockup-bookings": PREVIEW_IMGS / "app-bookings-v2.png",
}

MOCKUP_PROMPT = (
    "Photorealistic 3D product render of a brand-new iPhone 17 Pro in natural titanium finish. "
    "The iPhone is positioned PROMINENTLY in the center of the frame and fills approximately "
    "88-92% of the vertical height — close, large, and readable. "
    "DYNAMIC angled pose: about 15 degrees forward-back rotation and 12 degrees yaw, giving "
    "clear 3D dimensionality and a premium magazine / Apple-keynote feel, WHILE keeping the "
    "screen content fully readable. Visible Dynamic Island, subtle screen curvature at edges, "
    "polished titanium frame catching soft light reflections. "
    "Place THE ATTACHED IMAGE as the exact content of the iPhone's screen, perspective-warped to "
    "match the phone tilt. CROP the top padding of the attached image if present — the app's main "
    "content (the logo / header / first card) should sit as close as possible to the status bar, "
    "with NO extra empty space between them. Preserve screen colors, contrast, and text crispness. "
    "A soft realistic drop shadow falls below the floating phone. "
    "Background: PURE WHITE (#FFFFFF). No gradients, no colored backdrop, no clutter — just white, "
    "so the image can be isolated. The drop shadow may be soft gray and is welcome. "
    "ULTRA-SHARP focus on the entire phone. No text, no watermarks, no logos other than what is "
    "already on the screen content. Portrait composition, aspect ratio 3:4, maximum detail."
)


def upload(path: pathlib.Path) -> str:
    print(f"  uploading {path.name} ({path.stat().st_size // 1024} KB)")
    return fal_client.upload_file(str(path))


def fal_edit(prompt: str, src_url: str, aspect: str = "3:4", out: pathlib.Path = None):
    t0 = time.time()
    result = fal_client.subscribe(
        "fal-ai/nano-banana-pro/edit",
        arguments={
            "prompt": prompt,
            "image_urls": [src_url],
            "num_images": 1,
            "aspect_ratio": aspect,
            "output_format": "png",
        },
        with_logs=False,
    )
    url = result["images"][0]["url"]
    urllib.request.urlretrieve(url, out)
    print(f"  saved ({time.time() - t0:.1f}s) → {out.name}")
    return out


def fal_upscale_4k(path: pathlib.Path) -> pathlib.Path:
    """4x upscale via fal-ai/clarity-upscaler so final render approaches 4K."""
    print(f"  upscaling {path.name} to 4K...")
    t0 = time.time()
    src_url = fal_client.upload_file(str(path))
    result = fal_client.subscribe(
        "fal-ai/clarity-upscaler",
        arguments={
            "image_url": src_url,
            "upscale_factor": 4,
            "creativity": 0.12,          # keep the source faithful, do not hallucinate
            "resemblance": 1.0,          # maximum faithfulness to original
            "guidance_scale": 6,
            "num_inference_steps": 28,
            "output_format": "png",
        },
        with_logs=False,
    )
    url = result["image"]["url"]
    urllib.request.urlretrieve(url, path)  # overwrite in place
    img = Image.open(path)
    print(f"  upscaled ({time.time() - t0:.1f}s) → {img.size[0]}x{img.size[1]}")
    return path


# ─── Step C: background removal via flood fill from corners ─────────────────
def make_transparent(path: pathlib.Path, tolerance: int = 28) -> pathlib.Path:
    """Flood fill from 4 corners with tolerance; matched pixels become alpha=0.

    Tolerance is the Euclidean color distance in RGB space from each corner's
    sampled color. Keeps soft shadows (slightly gray) if tolerance is tight.
    """
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    pixels = img.load()

    # Sample corner colors (seed for flood fill)
    seeds = [
        ((0, 0),     pixels[0, 0]),
        ((w-1, 0),   pixels[w-1, 0]),
        ((0, h-1),   pixels[0, h-1]),
        ((w-1, h-1), pixels[w-1, h-1]),
    ]

    visited = bytearray(w * h)

    def dist(a, b):
        return ((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2) ** 0.5

    # BFS flood fill from each corner
    for start, seed_color in seeds:
        q = deque([start])
        while q:
            x, y = q.popleft()
            idx = y * w + x
            if x < 0 or x >= w or y < 0 or y >= h or visited[idx]:
                continue
            p = pixels[x, y]
            if dist(p, seed_color) > tolerance:
                continue
            visited[idx] = 1
            # soft alpha near the edge of tolerance (anti-aliasing)
            d = dist(p, seed_color)
            if d < tolerance * 0.6:
                alpha = 0
            else:
                alpha = int(255 * (d - tolerance * 0.6) / (tolerance * 0.4))
            pixels[x, y] = (p[0], p[1], p[2], alpha)
            q.extend([(x+1, y), (x-1, y), (x, y+1), (x, y-1)])

    img.save(path, "PNG")
    print(f"  transparentized → {path.name}")
    return path


def main():
    if not os.environ.get("FAL_KEY"):
        print("ERROR: FAL_KEY not set", file=sys.stderr)
        sys.exit(1)

    only = sys.argv[1:] if len(sys.argv) > 1 else None

    # STEP A — edit home screen (only if needed or not skipped)
    if not only or "edit-home" in only or "mockup-home" in only:
        if not HOME_EDIT_OUT.exists() or (only and "edit-home" in only):
            print("→ edit-home (replace empty state with Next Session card)")
            if not HOME_SRC.exists():
                print(f"  ERROR: source not found: {HOME_SRC}")
                sys.exit(1)
            src_url = upload(HOME_SRC)
            fal_edit(HOME_EDIT_PROMPT, src_url, aspect="9:16", out=HOME_EDIT_OUT)
        else:
            print(f"→ edit-home: already exists, skipping ({HOME_EDIT_OUT.name})")

    # STEP B — generate 3D mockups
    for name, src in MOCKUP_SOURCES.items():
        if only and name not in only and "all-mockups" not in only:
            continue
        print(f"→ {name}")
        if not src.exists():
            print(f"  ERROR: source not found: {src}")
            continue
        src_url = upload(src)
        out = OUT / f"{name}.png"
        try:
            fal_edit(MOCKUP_PROMPT, src_url, aspect="3:4", out=out)
            # Upscale to 4K while still on white background (easier to keep sharpness)
            if os.environ.get("UPSCALE_4K", "1") == "1":
                fal_upscale_4k(out)
            # Key out background last: any flood-fill tolerance applies to final res
            make_transparent(out, tolerance=28)
        except Exception as e:
            print(f"  ERROR on {name}: {e}")

    print("\nDone.")


if __name__ == "__main__":
    main()
