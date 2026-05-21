"""
Image generation for blog/reiki-a-distanza.html
Hero + 2 inline images, 1200x675, Holistic Unity editorial style.
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
    "reiki-a-distanza-hero": (
        "Two human silhouettes on opposite sides of the composition, separated by open space. "
        "The left figure has hands raised gently, sending rippling waves of warm gold and dusty mauve energy. "
        "The waves travel across the frame and envelop the right figure who reclines peacefully. "
        "Translucent concentric circles radiate from both figures, overlapping at the center of the image. "
        "The connection between the two figures glows with soft warm gold light."
    ),
    "reiki-a-distanza-inline1": (
        "A single human silhouette reclining in repose on a low surface at home, surrounded by soft glowing light. "
        "Gentle waves of warm energy in sage green and dusty mauve flow around and through the figure from above. "
        "Translucent petal-like shapes frame the figure. "
        "The atmosphere is deeply restful and peaceful."
    ),
    "reiki-a-distanza-inline2": (
        "A single human silhouette seated upright with hands held forward, palms open and facing outward. "
        "Concentric circles of warm gold and terracotta light emanate from the figure's palms, "
        "expanding outward like ripples on water. "
        "Large translucent overlapping lotus petals in sage green fill the background. "
        "The figure represents a practitioner sending energy at a distance."
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
