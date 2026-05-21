"""
Generate hero + 2 inline images for the 'The 5 Human Design Types Explained' blog post.
Style locked to brand standard (flat 2D editorial, grainy texture, silhouette figures, sage/mauve/terracotta/gold).
"""
import os, sys, fal_client, urllib.request, time, pathlib

OUT_DIR = pathlib.Path(__file__).parent
OUT_DIR.mkdir(parents=True, exist_ok=True)

STYLE = (
    "flat 2D editorial illustration in the style of Tatsuro Kiuchi and Oamul Lu. "
    "Visible grainy paper texture covering the entire image. "
    "Warm cream ivory gradient background with subtle color variation. "
    "Color palette strictly limited to: sage green, dusty mauve, warm beige, terracotta, soft dusty purple, warm gold. "
    "Stylized silhouette figure with absolutely no facial features, no eyes, no mouth. "
    "Simplified geometric body volumes, soft rounded shapes. "
    "Overlapping translucent geometric shapes in the background, lotus-like petals or concentric circles. "
    "Soft radial halo of warm gold light emanating from a focal point. "
    "Minimalist, serene, ethereal, newspaper-editorial quality. "
    "No text, no watermarks, no signatures, no logos, no letters anywhere in the image."
)

SCENES = {
    "human-design-types-explained-hero": (
        "Five distinct human silhouettes standing in a gentle arc across the composition, each "
        "rendered as a single solid color silhouette in a different palette tone — sage green, "
        "dusty mauve, terracotta, warm gold, soft dusty purple. Each figure stands in a slightly "
        "different posture suggesting a different energetic role. Behind them, a large translucent "
        "geometric bodygraph diagram with nine simplified geometric shapes connected by faint lines, "
        "in warm beige. A soft radial halo of warm gold light glows behind the central figure."
    ),
    "human-design-types-explained-bodygraph": (
        "A single human silhouette standing centered, body facing forward, arms gently at sides. "
        "Overlaid on the figure's torso, nine simplified geometric shapes arranged vertically — "
        "triangles, squares, and a diamond — connected by thin flowing lines, all rendered in dusty "
        "mauve, sage green, and terracotta. Translucent. The figure itself is rendered in deep plum "
        "silhouette. Soft warm gold light radiates from behind the figure's chest area."
    ),
    "human-design-types-explained-strategy": (
        "Two human silhouettes facing each other across the composition, one in sage green and one "
        "in terracotta, a soft warm gold orb of light floating between them representing a moment "
        "of decision and recognition. Concentric translucent circles in dusty mauve and warm beige "
        "ripple outward from the orb. The figures are rendered as simplified silhouettes with no "
        "facial features. Peaceful, contemplative, grounded."
    ),
}


def generate(prompt, outfile, width=1200, height=675):
    full_prompt = prompt + " " + STYLE
    print(f"  -> {outfile.name}")
    t0 = time.time()
    result = fal_client.subscribe(
        "fal-ai/flux-pro/v1.1",
        arguments={
            "prompt": full_prompt,
            "image_size": {"width": width, "height": height},
            "num_images": 1,
            "enable_safety_checker": False,
            "safety_tolerance": "6",
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

    for name, prompt in SCENES.items():
        out = OUT_DIR / f"{name}.jpg"
        try:
            generate(prompt, out)
        except Exception as e:
            print(f"    ERROR on {name}: {e}")

    print("\nDone.")


if __name__ == "__main__":
    main()
