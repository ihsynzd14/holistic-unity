"""Generate pranic-healing blog images using the locked Holistic Unity style."""
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
    "pranic-healing-hero": (
        "A single human silhouette standing centered, body facing forward, arms slightly raised "
        "with palms open at chest level. Soft swirling streams of warm gold and dusty mauve light "
        "flow outward from the open palms in elegant arcs, suggesting prana life energy moving through the figure. "
        "The figure is rendered as a unified silhouette in deep dusty purple. "
        "Behind the figure, large overlapping translucent circular shapes in sage green, terracotta, and warm beige. "
        "A soft radial halo of warm gold light surrounds the entire figure."
    ),
    "pranic-healing-energy-centers": (
        "A single human silhouette standing in profile, body composed of soft rounded volumes. "
        "Along the central vertical axis of the body, seven soft glowing orbs of light are arranged "
        "from the base of the figure up to the crown — each orb a different colour from the palette: "
        "terracotta at the base, dusty mauve at the heart, warm gold at the crown. "
        "Concentric translucent circles ripple gently outward from each orb. "
        "The figure is in sage green silhouette, the background warm cream with overlapping translucent ovals."
    ),
    "pranic-healing-session": (
        "Two human silhouettes in a calm wellness setting. "
        "One silhouette stands gently to the side, hands hovering a few centimetres above the other figure who is reclining on a soft surface. "
        "Soft flowing bands of warm gold and dusty mauve light pass between the practitioner's hands and the reclining figure's body. "
        "The standing figure is in dusty purple silhouette, the reclining figure in sage green silhouette. "
        "Background has overlapping translucent lotus-petal shapes in warm beige and terracotta, and a gentle radial halo of warm gold light."
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
    for name, prompt in SCENES.items():
        out = OUT_DIR / f"{name}.jpg"
        try:
            generate(prompt, out)
        except Exception as e:
            print(f"    ERROR on {name}: {e}")
    print("\nDone.")


if __name__ == "__main__":
    main()
