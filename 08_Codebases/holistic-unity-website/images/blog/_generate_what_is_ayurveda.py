"""
Flux Pro generation for what-is-ayurveda blog post.
Style locked to Holistic Unity's editorial illustration system.
Run with: FAL_KEY=... python3 _generate_what_is_ayurveda.py
"""
import os, sys, fal_client, urllib.request, time, pathlib

BASE_DIR = pathlib.Path(__file__).parent
OUT_DIR = BASE_DIR / "ayurveda_raw"
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
    "what-is-ayurveda-hero": (
        "A single human silhouette seated cross-legged in meditation, centered in the frame. "
        "Three glowing elemental orbs float gracefully around the figure: a swirling soft blue-purple wind motif on the upper left, "
        "a small radiant warm gold sun on the upper right, a cool sage green water-drop shape on the lower center. "
        "These represent the three doshas: vata (air), pitta (fire), kapha (earth and water). "
        "The figure wears simple flowing garments in dusty mauve. "
        "Behind the figure, large overlapping translucent lotus petals in warm beige and terracotta. "
        "A soft halo of warm gold light surrounds the entire scene. "
        "Peaceful, balanced, ancient wisdom feeling."
    ),
    "what-is-ayurveda-doshas": (
        "Three human silhouettes standing side by side at equal distance, each in a slightly different posture. "
        "The leftmost figure is slender and tall in dusty purple, surrounded by soft swirling wind lines (vata). "
        "The center figure is medium build in warm terracotta, surrounded by small radiating gold flame shapes (pitta). "
        "The rightmost figure is sturdy and grounded in sage green, surrounded by gentle wave shapes and small translucent circles (kapha). "
        "All three figures share the same warm cream background with subtle texture. "
        "Background features overlapping translucent circular shapes in warm beige."
    ),
    "what-is-ayurveda-routine": (
        "A single human silhouette in dusty mauve standing in a simple morning posture, arms gently extended at chest height. "
        "Beside the figure, a small wooden table with a steaming cup of warm beige tea and a few translucent leaves. "
        "Soft warm gold rays of morning sunlight stream in from the upper right corner. "
        "Behind the figure, overlapping translucent circles in sage green and terracotta represent the rhythm of daily routine. "
        "Calm, slow, intentional feeling of dinacharya (daily Ayurvedic routine)."
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
