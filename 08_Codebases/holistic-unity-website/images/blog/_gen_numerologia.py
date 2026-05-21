"""Generate images for numerologia-data-di-nascita blog post."""
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
    "numerologia-data-di-nascita-hero": (
        "A single human silhouette seated in meditation, centered in the frame. "
        "Around the figure, large translucent numerals from 1 to 9 float in concentric orbits, rendered in dusty mauve and warm gold. "
        "A soft radial halo of warm gold light emanates from the figure's chest. "
        "Behind the figure, overlapping translucent circles and lotus petals in sage green and terracotta fill the background. "
        "The figure's body is rendered as a single unified silhouette in deep warm beige."
    ),
    "numerologia-data-di-nascita-calcolo": (
        "A single human silhouette standing, one hand extended forward as if calculating or pointing. "
        "A cascade of large translucent circles, each containing a single digit, flows diagonally across the composition, "
        "converging toward a single glowing warm gold orb at the center. "
        "Overlapping translucent geometric shapes in sage green and dusty mauve fill the background. "
        "Soft warm gold light radiates from the central orb."
    ),
    "numerologia-data-di-nascita-numeri": (
        "A single human silhouette seated cross-legged, surrounded by nine large translucent lotus-petal shapes "
        "arranged in a circle, each petal in a different tone: sage green, dusty mauve, terracotta, warm beige, soft gold. "
        "A gentle radial halo of warm gold light glows from the figure's crown. "
        "The composition feels like a mandala of numbers and nature. Peaceful, serene, grounded."
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
        out = OUT_DIR / f"{name}.jpg"
        try:
            generate(prompt, out)
        except Exception as e:
            print(f"    ERROR on {name}: {e}")

    print("\nDone.")


if __name__ == "__main__":
    main()
