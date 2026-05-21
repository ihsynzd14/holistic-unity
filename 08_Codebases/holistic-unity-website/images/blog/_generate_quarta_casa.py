"""One-off generator for the Fourth Astrological House blog post."""
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
    "quarta-casa-astrologica-hero": (
        "A single human silhouette seated cross-legged at the base of a large stylized tree with deep curving roots "
        "spreading downward into the earth. The tree trunk and canopy are rendered in dusty mauve and sage green, "
        "with the canopy formed by soft overlapping circles. "
        "Behind the figure, the gentle outline of a simple house-shape made of translucent geometric forms in warm beige and terracotta, "
        "evoking home and family. "
        "A small crescent moon of warm gold light glows in the upper portion of the composition. "
        "The figure wears flowing garments in soft dusty purple. "
        "Concentric translucent circles ripple outward gently around the tree, conveying rootedness and inner foundation."
    ),
    "quarta-casa-astrologica-radici": (
        "A single human silhouette curled gently inward, resembling a person resting in a peaceful inner space. "
        "Below the figure, a network of soft curving lines like the roots of a tree extending downward into the earth, "
        "rendered in terracotta and warm gold. "
        "Above the figure, three or four overlapping translucent layered circles in dusty mauve and sage green, "
        "evoking a protective shelter or family lineage. "
        "A small soft orb of warm gold light glows at the figure's heart. "
        "The mood is contemplative, grounded, intimate."
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
        out = BASE_DIR / f"{name}.jpg"
        try:
            generate(prompt, out)
        except Exception as e:
            print(f"    ERROR on {name}: {e}")
    print("\nDone.")


if __name__ == "__main__":
    main()
