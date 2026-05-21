"""
Generate images for blog post: Human Design vs Astrology
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
    "human-design-vs-astrology-hero": (
        "Two stylized human silhouettes standing side by side. "
        "The left figure is surrounded by a large circular star map with concentric rings and small dots representing stars in dusty mauve and warm gold. "
        "The right figure is surrounded by an angular geometric bodygraph diamond shape with overlapping circles and small square centers in sage green and terracotta. "
        "Both figures face forward, each enclosed in their own soft radial glow. "
        "A gentle warm gold light bridges the space between them."
    ),
    "human-design-vs-astrology-chart": (
        "A large circular celestial mandala filling most of the frame. "
        "Concentric rings of soft dusty mauve and warm gold, with twelve equal segments marked by delicate translucent lines. "
        "Small geometric star shapes and dots scattered across the rings. "
        "A single small human silhouette sits at the center in meditation pose, bathed in warm gold radial light. "
        "The overall composition feels like a cosmic map."
    ),
    "human-design-vs-astrology-choice": (
        "A single human silhouette standing at a crossroads, two soft beams of light diverging to the left and right. "
        "The left beam is deep dusty mauve with concentric circle motifs. "
        "The right beam is sage green with angular geometric diamond shapes. "
        "The figure stands centered, arms slightly open, bathed in warm gold light from above. "
        "The background has overlapping translucent petals in warm beige and terracotta."
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
