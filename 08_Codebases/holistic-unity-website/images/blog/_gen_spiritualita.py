"""Generate images for spiritualita-significato blog post."""
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
    "spiritualita-significato-hero": (
        "A single human silhouette standing with arms gently opened to the sky, body facing forward, "
        "head slightly tilted upward as if contemplating something vast. "
        "Behind the figure, a large warm gold sun radiates concentric rings outward. "
        "Translucent overlapping geometric shapes in sage green, dusty mauve, and terracotta drift around the figure. "
        "The figure is rendered as a unified silhouette in deep dusty purple."
    ),
    "spiritualita-significato-pratica": (
        "Three human silhouettes in seated meditation pose, arranged in a gentle arc, all facing forward. "
        "Each figure is rendered in a different color: sage green, terracotta, dusty mauve. "
        "Soft warm gold light flows between them. Concentric translucent circles in warm beige "
        "expand outward from the center of the composition. Peaceful, communal, grounded."
    ),
    "spiritualita-significato-cammino": (
        "A single human silhouette walking along a softly winding path that ascends gently from the lower left to upper right. "
        "The path is rendered as a translucent ribbon of warm gold. "
        "Around the figure, small floating geometric shapes — circles, soft triangles, lotus petals — in sage green, "
        "dusty mauve, and terracotta drift gently. A warm gold glow on the horizon suggests sunrise."
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
