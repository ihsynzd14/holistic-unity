"""
Generate 1 hero + 2 inline images for blog/medicina-olistica.html
Style is locked - DO NOT EDIT the STYLE constant.
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
    "medicina-olistica-hero": (
        "A single human silhouette standing centered with arms relaxed at sides, "
        "viewed from the front. From the figure's body radiate four soft translucent waves "
        "in different colors: sage green flowing from the chest representing body, "
        "dusty mauve from the head representing mind, warm gold from the heart representing spirit, "
        "and terracotta from the abdomen representing emotion. "
        "All four waves blend into a single luminous halo that surrounds the entire figure. "
        "Background has subtle overlapping translucent circles. "
        "The figure is rendered as a unified deep plum silhouette. "
        "Integrated, balanced, whole."
    ),
    "medicina-olistica-discipline": (
        "A central tree-like form rising from the ground, with a slender trunk of warm gold "
        "and five thick branches spreading outward, each branch ending in a small simplified "
        "abstract symbol: a translucent lotus petal in sage green (energy work), a small spiral "
        "in dusty mauve (mind practices), a cluster of leaves in terracotta (herbal traditions), "
        "a wave pattern in warm beige (sound and breath), and a circle in soft gold (interpretive systems). "
        "Background has a soft radial glow at the center and subtle overlapping translucent shapes. "
        "Diverse, rooted, branching."
    ),
    "medicina-olistica-pratica": (
        "Two human silhouettes seated facing each other in a quiet consultation, "
        "one slightly larger as practitioner with hands gently open in a listening gesture, "
        "the other as client sitting attentively. Between them, a small floating constellation "
        "of soft warm gold points connected by gentle lines, representing the integrated "
        "assessment of the whole person. "
        "Both figures are rendered as deep plum silhouettes. "
        "Background has overlapping translucent lotus petals in sage green, dusty mauve, and terracotta. "
        "Attentive, respectful, integrated."
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
