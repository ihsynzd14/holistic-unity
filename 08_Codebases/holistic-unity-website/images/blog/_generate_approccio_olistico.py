"""
Generate 1 hero + 2 inline images for blog/approccio-olistico.html
Style is locked — DO NOT EDIT the STYLE constant.
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
    "approccio-olistico-hero": (
        "A single human silhouette standing centered with arms gently open, "
        "surrounded by three large overlapping translucent circles representing body, mind, and spirit. "
        "The circles intersect at the figure's heart, where a warm gold light glows. "
        "Each circle has a different color: sage green for body, dusty mauve for mind, terracotta for spirit. "
        "The figure is rendered as a unified deep plum silhouette. "
        "Calm, integrated, whole."
    ),
    "approccio-olistico-pratica": (
        "A single human silhouette seated in a calm contemplative pose on a simple chair, "
        "facing forward, hands resting in lap. "
        "Above and around the figure, gentle interconnected lines and small circles trace pathways "
        "between body, breath, and emotion in soft warm gold. "
        "Background has overlapping translucent ovals in sage green and dusty mauve. "
        "Quiet, attentive, grounded."
    ),
    "approccio-olistico-professionista": (
        "Two human silhouettes facing each other in a quiet conversation, one slightly larger as practitioner, "
        "one slightly smaller as client, separated by a small low table with a single gold candle. "
        "A soft warm gold halo encircles both figures, representing trust and presence. "
        "Background has overlapping translucent lotus petals in dusty mauve, sage green, and terracotta. "
        "Respectful, professional, warm."
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
