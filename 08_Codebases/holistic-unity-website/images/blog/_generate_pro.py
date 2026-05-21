"""
Flux Pro generation with hyper-detailed style prompt matching Holistic Unity's
existing category illustrations (Reiki.png, ThetaHealing.png, HumanDesign.png).

Style traits extracted from reference images:
  - grainy paper texture visible on the background
  - warm cream/ivory gradient, subtle color shift
  - flat 2D editorial illustration (Tatsuro Kiuchi, Oamul Lu lineage)
  - silhouette figures, no facial features
  - overlapping translucent geometric shapes (lotus petals, circles)
  - soft radial glow from a focal point of warm gold light
  - muted earth palette: sage green, dusty mauve, terracotta, warm beige, soft gold
  - simplified body volumes, gentle curves
"""
import os, sys, fal_client, urllib.request, time, pathlib

BASE_DIR = pathlib.Path(__file__).parent / "theta-healing"
BASE_DIR.mkdir(parents=True, exist_ok=True)

# Tight style anchor — matches the Reiki/ThetaHealing illustrations
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

# Content-only prompts
SCENES = {
    "pro_v1_meditation_theta_waves": (
        "A single human silhouette seated cross-legged in meditation, centered in the frame, "
        "head tilted slightly upward, hands resting on knees. "
        "Concentric rings of soft wavy theta brainwaves ripple outward from the crown of the head, "
        "rendered in dusty mauve and soft gold. "
        "The figure wears simple flowing garments in sage green. "
        "The backdrop has large overlapping translucent circular shapes in warm beige and terracotta."
    ),
    "pro_v2_lotus_awakening": (
        "A single human silhouette seated in lotus position, body facing forward. "
        "Behind the figure, a large layered lotus with eight translucent overlapping petals in sage green, "
        "dusty mauve, terracotta, and warm beige. "
        "A small radiant sun of warm gold light glows at the center of the figure's forehead. "
        "The figure's body is rendered as a single unified silhouette in deep plum."
    ),
    "pro_v3_between_states": (
        "A single human silhouette floating gently, reclining as if between waking and dreaming. "
        "Soft wavy bands of light in dusty mauve, sage, and warm gold flow across the composition like "
        "layered brainwaves. Particles of soft light drift upward. "
        "The figure is rendered as a warm terracotta silhouette. "
        "Background has overlapping translucent ovals and gentle vertical light rays."
    ),
    "pro_v4_inner_light": (
        "A single human silhouette standing centered, arms gently at sides, body facing forward. "
        "A large soft orb of warm gold light radiates from the figure's chest. "
        "Concentric translucent circles of sage green, dusty mauve, and terracotta ripple outward from the orb. "
        "Peaceful, grounded, transformative."
    ),
}


def generate(prompt: str, outfile: pathlib.Path, width: int = 1200, height: int = 675):
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
    return outfile


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
