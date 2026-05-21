"""
Generate hero + inline images for blog/significato-numeri.html
Run: FAL_KEY=<key> python3 _generate_significato_numeri.py
"""
import os, sys, fal_client, urllib.request, time, pathlib

BASE_DIR = pathlib.Path(__file__).parent
BASE_DIR.mkdir(parents=True, exist_ok=True)

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
    "significato-numeri-hero": (
        "A single human silhouette seated cross-legged in meditation, centered in the frame. "
        "Nine glowing geometric shapes float around the figure in a circular arrangement — each shape distinct: "
        "circle, triangle, square, spiral, star, diamond, crescent, hexagon, and radiant burst — "
        "rendered in warm gold, dusty mauve, and sage green. "
        "The figure is rendered as a deep plum silhouette. "
        "A soft radial halo of warm gold light emanates from behind the figure. "
        "The background has overlapping translucent concentric rings."
    ),
    "significato-numeri-sequenza": (
        "A single human silhouette standing with arms gently raised, surrounded by nine translucent "
        "concentric rings of increasing diameter, each ring shimmering in a different muted tone: "
        "sage green, dusty mauve, terracotta, warm beige, soft dusty purple, warm gold. "
        "The composition feels like a sacred geometry mandala centered on the figure. "
        "The figure is a warm terracotta silhouette. "
        "Large overlapping lotus petals in the background create depth."
    ),
}


def generate(prompt: str, outfile: pathlib.Path, width: int = 1200, height: int = 675):
    full_prompt = prompt + " " + STYLE
    print(f"  → {outfile.name}")
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
        out = BASE_DIR / f"{name}.jpg"
        try:
            generate(prompt, out)
        except Exception as e:
            print(f"    ERROR on {name}: {e}")

    print("\nDone.")


if __name__ == "__main__":
    main()
