"""
Inline images for the 'What is Theta Healing' blog post.
Locked to the V2 (lotus_awakening) visual language: lotus petals, plum silhouette,
warm gold focal light, sage/mauve/terracotta palette, grainy paper texture.
"""
import os, sys, fal_client, urllib.request, time, pathlib

BASE_DIR = pathlib.Path(__file__).parent / "theta-healing"
BASE_DIR.mkdir(parents=True, exist_ok=True)

# SAME style anchor as the chosen V2 hero
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

# One scene per major section break
SCENES = {
    # After "How a Theta Healing session actually works"
    "inline_session": (
        "Two human silhouettes seated facing each other in a quiet calm space. "
        "One silhouette is a practitioner with hands extended gently toward the other person. "
        "The second silhouette sits with eyes closed, relaxed, hands resting on the lap. "
        "A soft warm gold halo of light surrounds both figures, connecting them. "
        "Translucent concentric circles in sage green and dusty mauve frame the scene. "
        "Both figures are rendered as unified silhouettes in deep plum, no facial features."
    ),
    # After "Who is Theta Healing actually for?"
    "inline_who_its_for": (
        "Three human silhouettes of different heights standing side by side, centered in the frame, "
        "each rendered in a different muted color: sage green, dusty mauve, terracotta. "
        "All silhouettes face forward with no facial features. "
        "Behind them, large overlapping translucent lotus petals in warm beige and soft gold. "
        "A gentle shared halo of warm gold light rises behind the group."
    ),
    # After "What can you realistically expect?"
    "inline_transformation": (
        "A single human silhouette in deep plum, standing with arms gently opening outward. "
        "From the center of the chest, a radiant orb of warm gold light expands into "
        "concentric translucent circles in sage green, dusty mauve, and terracotta. "
        "Small particles of soft gold light drift upward around the figure. "
        "Grounded, awakening, transformative mood."
    ),
}


def generate(prompt: str, outfile: pathlib.Path, width: int = 1200, height: int = 675):
    full_prompt = prompt + " " + STYLE
    print(f"  \u2192 {outfile.name}")
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
