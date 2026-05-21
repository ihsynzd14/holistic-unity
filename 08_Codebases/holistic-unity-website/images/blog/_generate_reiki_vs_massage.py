"""Generate hero + inline images for reiki-vs-massage blog post."""
import os, sys, fal_client, urllib.request, time, pathlib

BASE_DIR = pathlib.Path(__file__).parent

STYLE = (
    "flat 2D editorial illustration in the style of Tatsuro Kiuchi and Oamul Lu. "
    "Visible grainy paper texture covering the entire image. "
    "Warm cream ivory gradient background with subtle color variation. "
    "Color palette strictly limited to: sage green, dusty mauve, warm beige, terracotta, soft dusty purple, warm gold. "
    "Stylized silhouette figures with absolutely no facial features, no eyes, no mouth. "
    "Simplified geometric body volumes, soft rounded shapes. "
    "Overlapping translucent geometric shapes in the background, lotus-like petals or concentric circles. "
    "Soft radial halo of warm gold light emanating from a focal point. "
    "Minimalist, serene, ethereal, newspaper-editorial quality. "
    "No text, no watermarks, no signatures, no logos, no letters anywhere in the image."
)

SCENES = {
    "reiki-vs-massage-hero": (
        "Two human silhouettes side by side in the composition, divided by a soft vertical band of warm gold light. "
        "On the left side, a silhouette is reclining peacefully on a massage table while another silhouette stands beside, "
        "hands hovering gently above the reclining figure's torso without touching, suggesting energy work. "
        "Soft concentric rings of warm gold light radiate from the practitioner's hands. "
        "On the right side, a silhouette lies face-down on a massage table while another silhouette uses both hands to "
        "press and knead the back muscles, suggesting physical therapeutic massage. "
        "Both scenes share the same warm ivory background. "
        "Behind both compositions, overlapping translucent lotus petals and concentric circles in sage green, "
        "dusty mauve, and terracotta. "
        "Calm, balanced, side-by-side editorial composition."
    ),
    "reiki-vs-massage-touch": (
        "Close-up illustration of two pairs of hands shown side by side, in symmetrical composition. "
        "On the left, a pair of hands hovers gently in the air above a reclining body, palms down, fingers slightly curved, "
        "with soft golden light radiating from the palms — no physical contact, energy work. "
        "On the right, a pair of hands rests firmly on a back, fingers pressing into muscle tissue, "
        "suggesting deep tissue massage and physical contact. "
        "Both pairs of hands are rendered as warm terracotta silhouettes. "
        "Translucent overlapping circles in sage green and dusty mauve frame each pair. "
        "Soft gold halo connects the two scenes at the center."
    ),
    "reiki-vs-massage-relaxation": (
        "A single human silhouette lying peacefully on a flat surface, eyes closed (no facial features visible), "
        "arms relaxed at the sides, deep in a state of meditation and relaxation. "
        "Soft wavy bands of light in sage green, dusty mauve, warm gold, and terracotta ripple across the body, "
        "suggesting a calmed nervous system and integrated energy. "
        "Above the figure, small particles of soft golden light drift upward. "
        "The figure is rendered as a dusty mauve silhouette on a warm cream background. "
        "Translucent overlapping lotus petals surround the scene."
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
        out = BASE_DIR / f"{name}.jpg"
        try:
            generate(prompt, out)
        except Exception as e:
            print(f"    ERROR on {name}: {e}")
    print("\nDone.")


if __name__ == "__main__":
    main()
