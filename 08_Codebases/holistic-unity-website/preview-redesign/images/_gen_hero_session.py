"""
Generate:
  1) hero-v4-session.jpg — Italian woman on couch with laptop, visibly engaged in
     a therapy video-session (speaking / listening / gesturing). 3:4 portrait.
     Laptop screen angled so its content is not the focus.
  2) therapist-callcard.jpg — Italian woman 35–45, dark hair, calm / slight smile,
     looking slightly off-camera as if on a video call. Square crop portrait.
     Warm neutral background (like a studio or home office).

Both via fal-ai/nano-banana-pro.
The therapist-callcard image is then used as an overlay inside a "video call
thumbnail" floating card anchored to the bottom-right of the hero photo.
"""
import os, sys, fal_client, urllib.request, time, pathlib

OUT = pathlib.Path(__file__).parent
OUT.mkdir(parents=True, exist_ok=True)

PHOTO_COMMON = (
    "Photograph, shot on Leica Q3 with a 28mm lens, natural window light from the left, "
    "muted warm color grade, realistic skin tones, soft film grain. "
    "Candid documentary feeling — NOT a stock photo, NOT overly staged, NOT glossy, NOT AI-tellish. "
    "Color palette reads warm cream, dusty rose, warm terracotta, soft plum, sage green. "
    "No text, no logos, no watermarks, no brand marks anywhere."
)

SCENES = {
    "hero-v4-session": (
        "An Italian woman around 35 years old with shoulder-length dark-brown hair, "
        "wearing a soft cream knit sweater, sitting cross-legged on a cream linen sofa. "
        "Her MacBook is open on her lap and angled away from the camera so the screen is "
        "only partially visible from the side — its content is NOT the focus. "
        "She is visibly ENGAGED in a therapy video-session: her right hand is lifted in a "
        "natural gesture mid-sentence, she is speaking softly, her expression is open and "
        "reflective. She looks toward the laptop screen with calm attention. "
        "A small ceramic cup of herbal tea sits on the side table. A terracotta pillow is "
        "beside her, a leafy plant in the background, warm sunlight spills from the left window. "
        "Three-quarter angle, mid-shot from slightly above the waist. Shallow depth of field, "
        "f/2.8, her face and sweater in sharp focus, background softly out of focus. "
        "3:4 portrait crop. "
        + PHOTO_COMMON
    ),
    "therapist-callcard": (
        "An Italian woman 38–42 years old with shoulder-length dark-brown wavy hair, "
        "warm olive skin, soft natural makeup, wearing a dusty-plum linen blouse. "
        "Calm, confident, slight reassuring smile, eyes looking slightly off-camera as if "
        "she is talking to someone on a video call. "
        "Shot from the chest up, centered. "
        "Background: a warm neutral home office — a soft cream wall, a small bookshelf corner "
        "out of focus on one side, a green leafy plant partially visible. "
        "Warm natural sunlight from the right. "
        "Square 1:1 crop, framed so the face is in the upper-center, leaving a little empty "
        "space at the bottom (for a UI label / name-tag overlay). "
        + PHOTO_COMMON
    ),
}

ASPECT = {
    "hero-v4-session": "3:4",
    "therapist-callcard": "1:1",
}


def generate(name: str, prompt: str):
    outfile = OUT / f"{name}.jpg"
    aspect = ASPECT.get(name, "3:4")
    print(f"  → {outfile.name} ({aspect})")
    t0 = time.time()
    result = fal_client.subscribe(
        "fal-ai/nano-banana-pro",
        arguments={
            "prompt": prompt,
            "num_images": 1,
            "aspect_ratio": aspect,
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
    only = sys.argv[1:] if len(sys.argv) > 1 else None
    for name, prompt in SCENES.items():
        if only and name not in only:
            continue
        try:
            generate(name, prompt)
        except Exception as e:
            print(f"    ERROR on {name}: {e}")
    print("\nDone.")


if __name__ == "__main__":
    main()
