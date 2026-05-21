"""
Generate hero + 1 inline illustration for blog/theta-healing-for-anxiety.html.
Reuses the locked Holistic Unity STYLE from _generate_pro.py.
"""
import os, sys, fal_client, urllib.request, time, pathlib

OUT_DIR = pathlib.Path(__file__).parent
SLUG = "theta-healing-for-anxiety"

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
        "A single solid black flat silhouette of a human figure shown in profile from the side, reclining peacefully on a low surface, head tilted slightly back, arms relaxed at the sides. "
        "The figure is a pure flat shape with absolutely no facial features, no eyes, no nose, no mouth, no hair details — only the outline silhouette of the body. "
        "Soft wavy concentric bands of theta brainwaves in dusty mauve and warm gold ripple outward from the crown of the head. "
        "A small cluster of dark angular shapes near the chest is being gently dissolved by warm gold light. "
        "Behind the figure are large overlapping translucent circles in sage green, terracotta, and warm beige."
    ),
    f"{SLUG}-inline1": (
        "A single human silhouette seated upright in stillness, hands resting on the lap, body facing forward. "
        "Two layered concentric rings of dusty mauve and sage green encircle the head like soft thought-waves quieting down. "
        "A radiant orb of warm gold light glows at the forehead. "
        "Below the figure, small terracotta angular fragments drift away and dissolve into the warm cream background. "
        "Peaceful, grounded, settled, transformative."
    ),
}


def generate(prompt, outfile, width=1200, height=675):
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
    targets = sys.argv[1:] if len(sys.argv) > 1 else list(SCENES.keys())
    for name in targets:
        if name not in SCENES:
            print(f"  -> skip unknown scene: {name}")
            continue
        out = OUT_DIR / f"{name}.jpg"
        try:
            generate(SCENES[name], out)
        except Exception as e:
            print(f"    ERROR on {name}: {e}")
    print("\nDone.")


if __name__ == "__main__":
    main()
