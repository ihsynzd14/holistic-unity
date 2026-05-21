"""
Image generation for blog post: reiki-pericoli
Hero + 1 inline image for "Reiki: Pericoli Reali o Falsi Miti?"
"""
import os, sys, fal_client, urllib.request, time, pathlib

BASE_DIR = pathlib.Path(__file__).parent

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
    "reiki-pericoli-hero": (
        "A single human silhouette seated peacefully, surrounded by gentle concentric rings of soft warm gold light. "
        "In the background, a large translucent question mark shape dissolves into overlapping circles of sage green and dusty mauve, "
        "suggesting myths dissolving into clarity. "
        "The figure appears calm and grounded, rendered in deep plum silhouette. "
        "Soft lotus petal shapes frame the composition in warm beige and terracotta."
    ),
    "reiki-pericoli-inline1": (
        "Two human silhouettes: one smaller figure standing in a posture of cautious inquiry, "
        "one larger silhouette sitting calmly with hands raised in a gentle offering gesture. "
        "A bridge of soft warm gold light connects them. "
        "Background features overlapping translucent ovals in sage green and dusty mauve. "
        "The composition suggests reassurance, safety, and gentle care."
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
