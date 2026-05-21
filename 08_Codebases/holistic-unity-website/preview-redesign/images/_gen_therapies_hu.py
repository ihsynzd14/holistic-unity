"""
Generate 9 brand-consistent therapy illustrations for Holistic Unity's
redesigned landing page — warm editorial botanical style.

Model: fal-ai/nano-banana-pro (Google Gemini 3 Pro Image) —
Produces cleaner, less AI-tellish illustrations than flux for this style.

Output: 4:3 ratio (for therapy card thumbnails)

Style anchor is unified across all 9 so they read as a set.
Each composition is an editorial still-life, not a mystical figure.
"""
import os, sys, fal_client, urllib.request, time, pathlib

OUT = pathlib.Path(__file__).parent
OUT.mkdir(parents=True, exist_ok=True)

STYLE = (
    "Flat 2D editorial illustration, magazine-quality, printed-paper feeling with "
    "subtle grainy paper texture visible across the whole image. "
    "Warm soft cream ivory background with gentle color variation (hex F3EDE0 to EFE7D5). "
    "Color palette strictly limited to: sage green, warm terracotta, dusty mauve, "
    "warm beige, deep plum, soft muted gold, creamy white. No neon, no pure black, no white highlights. "
    "Simplified shapes with clean silhouettes, organic curves, gentle gradients within shapes. "
    "Faces without features — no eyes, no mouth, no nose — only soft head shape if any human is shown. "
    "Centered composition with breathing room around the subject. "
    "Calm, honest, serene, contemporary editorial tone — NOT mystical, NOT new-age-cliché, "
    "NOT AI-looking, NOT glossy, NOT 3D. "
    "Absolutely no text, no letters, no numbers, no logos, no watermarks, no signatures anywhere in the image."
)

SCENES = {
    "hu-theta": (
        "An editorial still-life composition: two cupped human hands rise from the bottom of the frame, "
        "palms facing up, cradling a soft glowing orb of warm gold light. "
        "Three concentric wavy bands of dusty mauve ripple outward from the orb — representing theta brainwaves. "
        "A single sage-green leafy sprig curves behind the hands. "
        "Muted plum silhouette hands, cream background, warm gold orb, no face visible."
    ),
    "hu-reiki": (
        "An editorial still-life: a reclining figure seen only from the shoulders up, head resting on a soft "
        "beige pillow on the bottom-right of the frame (no facial features at all, just the contour). "
        "Above the figure, two palms face downward emanating warm gold rays of light toward the body. "
        "Small sage-green leaves float in the space between the hands and the figure. "
        "Composition balanced, serene, horizontal flow from hands to head."
    ),
    "hu-astro": (
        "An editorial still-life: a crescent moon rendered in deep plum, surrounded by a circle of "
        "twelve small sage-green and terracotta star-points arranged evenly in a ring. "
        "Two slender botanical sprigs (olive-like leaves) curve around the outer edge of the ring. "
        "A soft gold halo radiates gently behind the crescent moon. "
        "Symmetric circular composition on warm cream background."
    ),
    "hu-hd": (
        "An editorial still-life: an abstract vertical body-chart diagram — a simple elongated oval torso shape "
        "in dusty mauve with nine small geometric gates (triangles and squares) arranged at key body points, "
        "each gate glowing in warm gold, sage green, or terracotta. "
        "Two parallel vertical lines of soft light connect the gates. "
        "No face, no limbs, just the abstract energetic body-chart silhouette centered on cream background."
    ),
    "hu-num": (
        "An editorial still-life: nine small smooth river-pebbles arranged in a loose spiral pattern on the cream "
        "background, each pebble in a different warm color — sage, terracotta, mauve, plum, gold. "
        "A single curving sage-green vine with small leaves wraps gently around the spiral. "
        "Each pebble has subtle carved circular marks (no actual numbers or text). "
        "Top-down view, calm, minimalist, serene composition."
    ),
    "hu-ayur": (
        "An editorial still-life: three small ceramic bowls arranged in a gentle arc at the bottom of the frame, "
        "each bowl in warm terracotta, deep plum, and sage green, holding powdered spices (turmeric gold, "
        "cinnamon brown, henna red). Next to the bowls, a small brass oil lamp with a warm gold flame. "
        "Behind the bowls, three large lotus petals overlap translucently in dusty mauve and sage. "
        "Horizontal still-life composition on cream background."
    ),
    "hu-natu": (
        "An editorial still-life: a mortar and pestle in warm terracotta on the lower-left, containing a small "
        "bundle of crushed sage leaves. Next to it, two slender glass bottles in deep plum and sage green, "
        "corked, containing herbal tinctures. Rising above, three botanical sprigs — lavender, rosemary, and chamomile — "
        "arranged in a gentle fan. Warm gold soft light filters from the upper-right corner. "
        "Natural herbalism still-life on cream background, no text on bottles."
    ),
    "hu-cf": (
        "An editorial still-life: a circular arrangement of five simplified human silhouette figures "
        "(rendered as soft plum, mauve, and terracotta) connected at the feet by a single gentle root-line "
        "that flows underneath them. Above the circle, a soft gold halo of light. "
        "Each figure is shown from the waist up, faces featureless, heads slightly tilted toward the center. "
        "Symmetric circular composition, warm and respectful — representing family system connections."
    ),
    "hu-cs": (
        "An editorial still-life: seven small geometric nodes (three circles, two triangles, two squares) "
        "in sage green, terracotta, and deep plum, arranged in a flowing diagonal constellation across the frame, "
        "connected by thin soft gold lines that form an abstract network. "
        "A single slender botanical sprig curves through the composition. "
        "Representing systemic relationships and organizational patterns, on warm cream background."
    ),
}


def generate(prompt: str, outfile: pathlib.Path, aspect_ratio: str = "4:3"):
    full_prompt = prompt + "\n\n" + STYLE
    print(f"  → {outfile.name}")
    t0 = time.time()
    result = fal_client.subscribe(
        "fal-ai/nano-banana-pro",
        arguments={
            "prompt": full_prompt,
            "num_images": 1,
            "aspect_ratio": aspect_ratio,
            "output_format": "jpeg",
        },
        with_logs=False,
    )
    url = result["images"][0]["url"]
    urllib.request.urlretrieve(url, outfile)
    print(f"    saved ({time.time() - t0:.1f}s)")
    return outfile


def main():
    if not os.environ.get("FAL_KEY"):
        print("ERROR: FAL_KEY not set", file=sys.stderr)
        sys.exit(1)

    only = sys.argv[1:] if len(sys.argv) > 1 else None
    for name, prompt in SCENES.items():
        if only and name not in only:
            continue
        out = OUT / f"{name}.jpg"
        try:
            generate(prompt, out)
        except Exception as e:
            print(f"    ERROR on {name}: {e}")

    print("\nDone.")


if __name__ == "__main__":
    main()
