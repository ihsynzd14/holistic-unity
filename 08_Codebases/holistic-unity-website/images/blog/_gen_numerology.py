"""One-shot image generator for what-is-numerology blog post."""
import os, sys, fal_client, urllib.request, time, pathlib

OUT_DIR = pathlib.Path(__file__).parent
# SECURITY: never bake the FAL key into a file that could be deployed.
# Pass it via the environment: `FAL_KEY=... python3 _gen_numerology.py`.
# A previous version of this file shipped a hardcoded fallback; that key
# has been rotated. If you see one here in a future commit, REJECT IT.
if not os.environ.get("FAL_KEY"):
    print("ERROR: FAL_KEY env var not set. See CLAUDE.md.", file=sys.stderr)
    sys.exit(1)

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
    "what-is-numerology-hero": (
        "A single human silhouette standing centered, arms slightly open as if receiving wisdom. "
        "Nine translucent concentric circles of increasing size radiate outward from the figure, "
        "rendered in alternating sage green, dusty mauve, and warm gold. "
        "Behind the figure, a large mandala of overlapping geometric diamond and hexagon shapes in warm beige and terracotta. "
        "A soft radiant glow of warm gold light pulses from the figure's chest. "
        "The composition feels cosmic and contemplative."
    ),
    "what-is-numerology-chart": (
        "A silhouette figure seated cross-legged, slightly elevated, surrounded by nine large translucent circles "
        "arranged in a ring around the figure like a crown or halo formation. "
        "Each circle glows gently in one of the palette colors: sage green, dusty mauve, terracotta, warm beige, soft gold. "
        "Delicate arcing lines connect the circles to the figure's hands and crown. "
        "The background has layered concentric ovals and a soft cream-ivory gradient."
    ),
}


def generate(name, prompt, width=1200, height=675):
    full_prompt = prompt + " " + STYLE
    out = OUT_DIR / f"{name}.jpg"
    print(f"Generating {out.name} ...")
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
    urllib.request.urlretrieve(url, out)
    print(f"  saved {out} ({time.time()-t0:.1f}s)")


for name, prompt in SCENES.items():
    try:
        generate(name, prompt)
    except Exception as e:
        print(f"ERROR {name}: {e}", file=sys.stderr)

print("Done.")
