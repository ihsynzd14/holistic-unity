"""Generate hero + 2 inline images for sessione-olistica-online post."""
import os, sys, fal_client, urllib.request, time, pathlib

OUT_DIR = pathlib.Path(__file__).parent
SLUG = "sessione-olistica-online"

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
        "A single human silhouette seated on a soft cushion in a warm interior, gently facing a softly glowing rectangular screen "
        "that emits warm gold light. Hands rest in the lap. The figure wears flowing garments in dusty mauve and sage green. "
        "A small lit candle and a green plant sit on a low side table. Translucent overlapping circles in terracotta and warm beige "
        "drift in the background, suggesting a calm, intimate online session at home."
    ),
    f"{SLUG}-spazio": (
        "A serene corner of a room prepared for a holistic online session: a soft round cushion on the floor, "
        "a lit beeswax candle in dusty mauve, a small ceramic vase with a single sage-green leaf, "
        "a folded warm-beige blanket, and a closed notebook with a pen. "
        "Warm gold light streams in softly from the side. Translucent concentric circles in terracotta drift behind. "
        "No human figure, only the prepared space, peaceful and grounded."
    ),
    f"{SLUG}-dopo": (
        "A single human silhouette seated comfortably writing in an open notebook resting on the lap. "
        "A warm cup of herbal tea sits beside them, gently steaming in soft gold lines. "
        "The figure wears flowing garments in sage green; the body is rendered as a unified silhouette in dusty mauve. "
        "Behind, large overlapping translucent lotus petals in warm beige and terracotta. A soft radial halo of warm gold light "
        "glows from the chest area, suggesting integration after an online holistic session."
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
