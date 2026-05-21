"""
Image generation for blog/how-to-read-human-design-chart.html
Uses fal-ai/flux-pro/v1.1 with the locked Holistic Unity style.
"""
import os, sys, fal_client, urllib.request, time, pathlib

OUT_DIR = pathlib.Path(__file__).parent
SLUG = "how-to-read-human-design-chart"

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
    "No text, no watermarks, no signatures, no logos, no letters or numbers anywhere in the image."
)

SCENES = {
    f"{SLUG}-hero": (
        "A single human silhouette standing centered, body facing forward, arms gently at sides. "
        "Floating in front of and around the figure: nine translucent geometric shapes connected by thin glowing lines, "
        "forming a vertical map across the body — a triangle near the head in dusty mauve, "
        "a small square at the throat in sage green, a diamond at the chest in terracotta, "
        "another diamond at the solar plexus in warm gold, a square at the navel in dusty purple, "
        "and softer shapes lower down. Thin luminous channels in warm gold connect the shapes. "
        "The figure is rendered as a unified silhouette in deep plum. "
        "Background has overlapping translucent circles in warm beige and sage green."
    ),
    f"{SLUG}-centers": (
        "Nine translucent geometric shapes floating against a warm cream gradient: "
        "a soft triangle, two square shapes, two diamond shapes, and gentle rounded forms, "
        "rendered in dusty mauve, sage green, terracotta, warm gold, and dusty purple. "
        "Thin luminous channels of warm gold light flow between the shapes, connecting them. "
        "A radial halo of soft gold light emanates from the center of the composition. "
        "No human figure — pure geometric composition. "
        "Background has overlapping translucent circles and soft vertical light rays."
    ),
    f"{SLUG}-types": (
        "Five human silhouettes arranged in a gentle horizontal row, each rendered in a different palette color "
        "from sage green, dusty mauve, terracotta, warm gold, and dusty purple. "
        "Each silhouette has a slightly different posture — one standing tall, one with arms open, "
        "one seated in lotus, one leaning forward, one with hands at heart center. "
        "Above each figure floats a small translucent geometric shape — circle, triangle, square — "
        "in soft warm tones. "
        "Background is a warm cream ivory gradient with overlapping translucent circles in beige and mauve. "
        "Soft radial halo of warm gold light behind the central figure."
    ),
}


def generate(prompt: str, outfile: pathlib.Path, width: int = 1200, height: int = 675):
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
