"""
Image generation for vedic-vs-western-astrology blog post.
Uses fal-ai/flux-pro/v1.1 with the locked Holistic Unity STYLE prompt.
"""
import os, sys, fal_client, urllib.request, time, pathlib

BASE_DIR = pathlib.Path(__file__).parent
SLUG = "vedic-vs-western-astrology"

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
    f"{SLUG}-hero": (
        "Two large translucent circular zodiac wheels overlapping side by side in the center of the frame, "
        "one in dusty mauve and warm gold (representing Vedic astrology), one in sage green and terracotta "
        "(representing Western astrology). Each wheel is divided into twelve faint segments and rendered as "
        "concentric translucent rings. Between them, a small silhouette figure stands with arms slightly raised, "
        "facing the viewer, in deep plum. Soft golden constellation dots scatter across the background. "
        "Two zodiac systems visualized as overlapping celestial diagrams, no labels, no text."
    ),
    f"{SLUG}-stars": (
        "A single human silhouette seated cross-legged in profile, gazing upward at a sky filled with "
        "scattered translucent stars and a soft band of celestial light. The sky has overlapping translucent "
        "ovals in dusty mauve and sage green suggesting the ecliptic and the constellations. "
        "A delicate gold crescent and one larger orb of warm gold light hover above the figure. "
        "The figure is rendered as a warm terracotta silhouette."
    ),
    f"{SLUG}-chart": (
        "Centered composition of one large circular birth chart wheel rendered as overlapping translucent rings "
        "in sage green, dusty mauve, terracotta, and warm gold. Twelve simple radial lines divide the wheel into "
        "houses. Small silhouette hands enter from the bottom edge of the frame, gently holding the wheel as if "
        "studying it. Soft golden particles drift around the chart. "
        "Background has overlapping translucent circles in warm beige."
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
