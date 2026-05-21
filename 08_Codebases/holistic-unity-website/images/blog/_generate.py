"""
Holistic Unity — blog image generator via FAL AI.

Reusable script for every future blog post.

Usage:
    export FAL_KEY="..."
    python3 _generate.py thumbnails   # only hero variations
    python3 _generate.py inline       # inline images only
    python3 _generate.py all          # everything
    python3 _generate.py custom <prompt> <outfile>   # one-off

Edit SCENES at top of file per post. Reusable STYLE_ANCHOR enforces brand consistency.
"""
import os, sys, fal_client, urllib.request, time, pathlib

# Site visual language — lock this so every post looks consistent.
STYLE_ANCHOR = (
    "flat 2D editorial illustration, minimalist, serene, ethereal. "
    "Warm cream ivory gradient background with subtle grainy paper texture. "
    "Muted earth-tone palette: sage green, dusty mauve, warm beige, terracotta, soft gold. "
    "Stylized human figure with simplified geometric body and no facial features. "
    "Soft radiant glow, gentle halo of warm light. "
    "Clean lines, no realistic shading, no photographic detail. "
    "Calming wellness aesthetic, spiritual but grounded. "
    "Style: Tatsuro Kiuchi meets Jessica Hische, apple meditation app illustration style. "
    "No text, no watermarks, no signatures."
)

# --- Per-post scene descriptions ------------------------------------------------
POST_SLUG = "theta-healing"

THUMBNAIL_VARIANTS = [
    # v1 — meditating figure + theta brainwave halo
    "A single figure seated cross-legged in meditation, eyes closed peacefully. "
    "Above their head, a soft swirling halo of wavy lines representing theta brainwaves, "
    "glowing with gentle gold light. The body is rendered in dusty mauve and sage clothing. "
    "Centered composition, calm and contemplative.",

    # v2 — figure inside lotus aura
    "A figure in lotus position, serene and still, enveloped in a large soft lotus-shaped aura "
    "with overlapping translucent petals in sage, mauve, and warm beige. "
    "Rays of soft gold light radiate from the center of the figure's forehead.",

    # v3 — dissolving into light
    "A meditating figure whose outline gently dissolves at the edges into particles and soft light, "
    "representing the theta state between waking and dreaming. Warm gold and dusty purple glows "
    "cascade around the figure. Dreamlike, ethereal, transcendent.",
]

INLINE_SCENES = {
    "inline-1-short-answer": (
        # After "The short answer"
        "Close-up of a single meditating figure in serene profile, eyes closed. "
        "Above the figure's head, softly glowing theta brainwave rings expand outward. "
        "Mauve and gold tones. Contemplative and calm."
    ),
    "inline-2-session-works": (
        # After "How a session works"
        "Two figures facing each other in a gentle energetic exchange, one guiding, one receiving. "
        "Soft streams of warm golden light flow between them, a visual metaphor for inner work. "
        "One figure wears sage, the other dusty mauve. Symmetrical, balanced composition."
    ),
    "inline-3-who-for": (
        # After "Who is it for"
        "A single figure standing at a soft crossroads, bathed in warm morning light. "
        "Behind them, faint silhouettes of old patterns dissolve into light. "
        "Ahead, an open path of soft gold. Hopeful, quiet transformation."
    ),
}
# -------------------------------------------------------------------------------

BASE_DIR = pathlib.Path(__file__).parent / POST_SLUG
BASE_DIR.mkdir(parents=True, exist_ok=True)


def generate(prompt: str, outfile: pathlib.Path, model: str = "fal-ai/flux/schnell",
             width: int = 1200, height: int = 675, steps: int = 4):
    full_prompt = prompt + " " + STYLE_ANCHOR
    print(f"  → {outfile.name}  (model={model}, {width}x{height})")
    t0 = time.time()
    result = fal_client.subscribe(
        model,
        arguments={
            "prompt": full_prompt,
            "image_size": {"width": width, "height": height},
            "num_inference_steps": steps,
            "num_images": 1,
            "enable_safety_checker": False,
        },
        with_logs=False,
    )
    url = result["images"][0]["url"]
    urllib.request.urlretrieve(url, outfile)
    print(f"    saved ({time.time() - t0:.1f}s)  {outfile}")
    return outfile


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"

    if mode in ("thumbnails", "all"):
        print(f"\n[THUMBNAILS] generating {len(THUMBNAIL_VARIANTS)} hero variants for {POST_SLUG}")
        for i, scene in enumerate(THUMBNAIL_VARIANTS, 1):
            out = BASE_DIR / f"thumb_v{i}.jpg"
            generate(scene, out)

    if mode in ("inline", "all"):
        print(f"\n[INLINE] generating {len(INLINE_SCENES)} inline images for {POST_SLUG}")
        for name, scene in INLINE_SCENES.items():
            out = BASE_DIR / f"{name}.jpg"
            generate(scene, out, width=1200, height=700)

    if mode == "custom" and len(sys.argv) >= 4:
        prompt, outfile = sys.argv[2], BASE_DIR / sys.argv[3]
        generate(prompt, outfile)

    print("\nDone.")


if __name__ == "__main__":
    if not os.environ.get("FAL_KEY"):
        print("ERROR: FAL_KEY env var not set", file=sys.stderr)
        sys.exit(1)
    main()
