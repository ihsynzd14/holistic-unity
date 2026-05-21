"""Generate hero + inline images for blog post: reiki-for-anxiety
Style locked to match existing Holistic Unity category illustrations."""
import os, sys, fal_client, urllib.request, time, pathlib

OUT_DIR = pathlib.Path(__file__).parent
SLUG = "reiki-for-anxiety"

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
        "A single human silhouette reclining peacefully on a soft surface, eyes closed, body in a calm "
        "horizontal repose. Two stylized hands hover gently above the chest and head of the figure, "
        "rendered as soft sage green silhouettes, palms facing down. From the hands, soft concentric "
        "rings of warm gold and dusty mauve light ripple outward, gently dissolving small dark angular "
        "shapes near the figure's chest that represent anxiety leaving the body. "
        "Background has overlapping translucent circles in warm beige and terracotta. "
        "A soft halo of warm gold light surrounds the entire scene."
    ),
    f"{SLUG}-session": (
        "A close composition showing a single human silhouette seated upright on a simple chair, "
        "head slightly tilted forward in surrender, shoulders softening downward. "
        "A second silhouette in sage green stands behind, with hands resting lightly on the seated "
        "figure's shoulders and crown. Soft wavy bands of warm gold light flow downward from the "
        "standing figure's hands across the seated figure's torso. "
        "The seated figure is in dusty mauve, the background in warm beige with overlapping "
        "translucent circular shapes."
    ),
    f"{SLUG}-research": (
        "A single human silhouette seated cross-legged with hands resting open on knees, head bowed "
        "slightly. The chest area glows with a soft orb of warm gold light. Around the figure, "
        "translucent overlapping circles in sage green and dusty mauve represent waves of calming "
        "energy. Tiny particles of soft light drift gently upward. "
        "The figure is rendered as a unified silhouette in deep terracotta. "
        "The composition is balanced, grounded, serene — evoking measured, evidence-based calm."
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
    print(f"     saved ({time.time() - t0:.1f}s)")


def main():
    if not os.environ.get("FAL_KEY"):
        print("ERROR: FAL_KEY not set", file=sys.stderr)
        sys.exit(1)
    for name, prompt in SCENES.items():
        out = OUT_DIR / f"{name}.jpg"
        try:
            generate(prompt, out)
        except Exception as e:
            print(f"     ERROR on {name}: {e}")
    print("Done.")


if __name__ == "__main__":
    main()
