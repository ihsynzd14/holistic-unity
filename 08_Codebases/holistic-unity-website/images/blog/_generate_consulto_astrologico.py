"""Generate hero + 2 inline images for the 'consulto-astrologico-online' blog post."""
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
    "consulto-astrologico-online-hero": (
        "A single human silhouette seated at a small wooden table, looking at a circular astrological birth chart "
        "drawn on parchment in front of them. The chart is divided into twelve segments with simple zodiac glyphs "
        "in dusty mauve and warm gold. Behind the figure a large translucent circle suggests the cosmos with "
        "small stylized stars and planet orbits in sage green and terracotta. "
        "The figure wears flowing garments in warm beige. Soft radial gold light glows from the centre of the chart."
    ),
    "consulto-astrologico-online-videocall": (
        "A single human silhouette seated comfortably on a sofa with a laptop on their lap. "
        "On the laptop screen, a circular astrological chart with twelve houses is visible in dusty mauve and warm gold. "
        "A second smaller silhouette figure appears on the screen as the astrologer, gesturing gently. "
        "The room around the figure is rendered with overlapping translucent shapes in sage green and terracotta. "
        "Warm gold light spills from the laptop screen across the figure. Intimate, calm, modern setting."
    ),
    "consulto-astrologico-online-stars": (
        "A single human silhouette standing centred, head gently tilted upward, hands open at the sides. "
        "Above and around the figure, a large translucent celestial mandala with twelve concentric segments — "
        "each segment containing a simple zodiac symbol in dusty mauve, terracotta, and sage. "
        "Constellation lines connect small warm gold stars across the composition. "
        "The figure is rendered as a deep plum silhouette. A radial halo of soft gold light glows behind the head."
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
