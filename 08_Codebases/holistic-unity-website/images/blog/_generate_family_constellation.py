"""
Generate hero + inline images for the what-happens-family-constellation blog post.
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
    "what-happens-family-constellation-hero": (
        "A small circle of five human silhouettes standing in a loose constellation arrangement, "
        "each figure facing inward toward a central soft warm gold orb of light. "
        "One figure stands slightly apart, as the person representing the client. "
        "Gentle connecting lines of translucent dusty mauve light link the figures. "
        "The background has large concentric translucent circles suggesting a family tree expanding outward. "
        "Palette: deep plum silhouettes, sage green connecting arcs, warm gold center glow, terracotta accents."
    ),
    "what-happens-family-constellation-session": (
        "A single human silhouette seated in a contemplative pose, facing a soft arrangement of "
        "three smaller silhouettes standing at varying distances — representing family members placed in a constellation. "
        "Translucent layered geometric rings emanate from the group, suggesting systemic energy. "
        "Warm gold light glows between the figures. Background in warm cream with large overlapping "
        "translucent ovals in sage green and dusty mauve."
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
