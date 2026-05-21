"""One-shot image generator for terapista-olistico-online blog post."""
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
    "terapista-olistico-online-hero": (
        "Two human silhouettes facing each other across a glowing golden portal of light, "
        "representing an online holistic consultation. One silhouette is seated comfortably at home, "
        "the other appears as a calm practitioner figure within a luminous oval frame. "
        "Concentric rings of sage green and dusty mauve radiate outward from the portal. "
        "Background has large translucent lotus petals in warm beige and terracotta. "
        "The composition is horizontal, balanced, and serene."
    ),
    "terapista-olistico-online-scelta": (
        "A single human silhouette standing at a crossroads of three glowing paths of warm gold light, "
        "each path leading toward a different soft luminous circle representing a practitioner. "
        "The figure stands centered, calm, contemplative. "
        "Background has overlapping translucent circles in sage green and dusty mauve. "
        "A soft radial glow of warm gold light at the center of the composition."
    ),
    "terapista-olistico-online-sessione": (
        "A single reclining human silhouette in a peaceful home setting, bathed in soft warm golden light. "
        "Above the figure, translucent concentric circles rise gently like ripples, suggesting energy healing at a distance. "
        "The palette is sage green, warm beige, and dusty mauve. "
        "Background features large overlapping lotus petal shapes. Serene, intimate, safe."
    ),
}


def generate(prompt, outfile, width=1200, height=675):
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
