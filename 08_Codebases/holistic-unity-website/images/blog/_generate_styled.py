"""
Holistic Unity blog image generator — style-referenced via Flux Redux.

Uses an existing site illustration (e.g. Reiki.png) as a style anchor so
new images match the grainy editorial-illustration quality of the rest of the site.

Usage:
    export FAL_KEY="..."
    python3 _generate_styled.py
"""
import os, sys, fal_client, urllib.request, time, pathlib

STYLE_REF = pathlib.Path("/Users/marcello/Desktop/Holistic Unity/holistic-unity-website/images/categories/Reiki.png")
BASE_DIR = pathlib.Path(__file__).parent / "theta-healing"
BASE_DIR.mkdir(parents=True, exist_ok=True)

# Scene prompts — style comes from the reference image, so prompts focus on content
SCENES = {
    # thumbnail variants at 16:9
    "styled_thumb_v1": (
        "A single person seated cross-legged in meditation, eyes closed, "
        "surrounded by soft concentric waves of light representing theta brainwaves. "
        "Warm cream background, flat editorial illustration with grainy texture."
    ),
    "styled_thumb_v2": (
        "A person in lotus meditation position, with soft translucent lotus petals "
        "glowing behind them in sage, mauve, and warm beige. "
        "A small radiant sun of light glows at the center of the forehead. "
        "Editorial illustration, cream background, grainy paper texture."
    ),
    "styled_thumb_v3": (
        "A meditating figure at the threshold of sleep and wakefulness, "
        "softly dissolving at the edges into warm particles of light. "
        "Pastel gold and dusty mauve auras. Editorial flat illustration."
    ),
}


def upload_style_ref():
    print(f"Uploading style reference: {STYLE_REF.name}")
    url = fal_client.upload_file(str(STYLE_REF))
    print(f"  → {url}")
    return url


def generate_with_redux(prompt: str, style_url: str, outfile: pathlib.Path,
                        width: int = 1200, height: int = 675):
    """Flux Pro Redux: style transfer from reference image."""
    print(f"  → {outfile.name}")
    t0 = time.time()
    result = fal_client.subscribe(
        "fal-ai/flux-pro/v1.1/redux",
        arguments={
            "prompt": prompt,
            "image_url": style_url,
            "image_size": {"width": width, "height": height},
            "num_inference_steps": 28,
            "guidance_scale": 3.5,
            "num_images": 1,
            "enable_safety_checker": False,
        },
        with_logs=False,
    )
    url = result["images"][0]["url"]
    urllib.request.urlretrieve(url, outfile)
    print(f"    saved ({time.time() - t0:.1f}s)  {outfile.name}")
    return outfile


def main():
    if not os.environ.get("FAL_KEY"):
        print("ERROR: FAL_KEY not set", file=sys.stderr)
        sys.exit(1)

    style_url = upload_style_ref()
    print()

    for name, prompt in SCENES.items():
        out = BASE_DIR / f"{name}.jpg"
        try:
            generate_with_redux(prompt, style_url, out)
        except Exception as e:
            print(f"    ERROR on {name}: {e}")
    print("\nDone.")


if __name__ == "__main__":
    main()
