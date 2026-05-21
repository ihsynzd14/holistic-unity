"""
Image generation for ottava-casa-astrologica blog post.
Hero + 1 inline. Style locked to Holistic Unity editorial illustration.
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
    "ottava-casa-astrologica-hero": (
        "A single human silhouette standing at the center of a dark mauve circular doorway or threshold, "
        "rendered as a deep terracotta silhouette. The doorway is the eighth segment of a large circular wheel "
        "divided into twelve translucent slices in sage green, dusty mauve, warm beige and terracotta. "
        "A soft scorpion-tail spiral of warm gold light curls behind the figure. "
        "Below the figure, dusty mauve waves suggest deep water. "
        "Above, a small radiant gold sun-eclipse motif. "
        "The image evokes transformation, depth, and a passage from one state to another."
    ),
    "ottava-casa-astrologica-pianeti": (
        "Three small silhouette figures standing close together inside a single translucent dusty-mauve sphere, "
        "rendered as warm terracotta silhouettes. Around the sphere, layered concentric circles in sage green and warm gold "
        "ripple outward. Two stylized planets — one small dusty-purple Pluto with a soft halo, one slightly larger dusty-mauve Scorpio glyph spiral — "
        "float in the upper third of the composition. The figures share a single golden thread of light that connects their hearts. "
        "The mood is intimate, intense, transformative."
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
