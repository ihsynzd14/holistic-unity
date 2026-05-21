"""
Generate realistic hero photographs for the Holistic Unity landing page.

Requirements:
- Hero must look like a real photo (not AI-tellish).
- Therapist must NOT be visible on the laptop screen (user explicitly requested).
- The laptop should show an abstract/UI-ish surface — e.g. a calendar view, a neutral
  video-call interface with no face visible, or simply closed/angled.
- Subject: an Italian woman in her 30s-40s, relaxed at home, mid video-call session.
- Styling: warm cream/terracotta/plum interior, natural light, tasteful.
- Aspect: 3:4 (portrait) — the hero photo column in the grid.

Model: fal-ai/nano-banana-pro (Google Gemini 3 Pro Image) — produces more natural-looking
people than flux-pro at this scale.
"""
import os, sys, fal_client, urllib.request, time, pathlib

OUT = pathlib.Path(__file__).parent
OUT.mkdir(parents=True, exist_ok=True)

COMMON = (
    "Photograph, shot on Leica Q3 with a 28mm lens, natural window light from the left, "
    "muted warm color grade, realistic skin tones, soft film grain. "
    "Shallow depth of field, f/2.8, subject in sharp focus. "
    "Warm interior: cream linen sofa, terracotta pillow, a small ceramic mug of herbal tea, "
    "a leafy plant in a soft terracotta pot, morning sunlight. "
    "Candid documentary feeling — NOT a stock photo, NOT overly staged, NOT glossy. "
    "Color palette reads warm cream, dusty rose, warm terracotta, soft plum, sage green. "
    "No text, no logos, no watermarks, no brand marks anywhere."
)

SCENES = {
    "hero-v3-client-laptop-calendar": (
        "An Italian woman around 35 years old with shoulder-length dark-brown hair, wearing a soft "
        "cream knit sweater, sitting comfortably on a cream linen sofa. Her MacBook is open on her lap "
        "and she is looking thoughtfully at the screen — the laptop SCREEN SHOWS A CLEAN CALENDAR / "
        "APPOINTMENT BOOKING INTERFACE with date tiles and time slots, NOT a person's face, NOT a "
        "video call with anyone on it. "
        "Her expression is calm, slightly curious, natural. "
        "The room is warmly lit, a terracotta-colored cushion next to her, a small cup of tea on the "
        "side table, a leafy plant in the background, soft golden hour light spilling from the window. "
        "Three-quarter angle, mid-shot from slight-above waist, viewer is about 2 meters away. "
        "Photographic, not illustration, not AI-looking. "
        + COMMON
    ),
    "hero-v3-client-laptop-closed": (
        "An Italian woman around 35 years old with shoulder-length dark-brown hair, wearing a warm "
        "dusty-rose linen shirt, sitting cross-legged on a cream linen sofa, holding a ceramic mug "
        "of herbal tea in both hands, looking softly off-camera, calm and reflective. "
        "Her laptop is closed on the side table next to her, a notebook with a pen on top. "
        "The room is warmly lit by morning sunlight from a window on the left, a small terracotta "
        "pot with a green leafy plant on the floor. "
        "Mid-shot from waist up, three-quarter angle. "
        "Mood: the calm AFTER a session — grounded, at-home wellness moment. "
        "Photographic, documentary feeling, not AI-tellish. "
        + COMMON
    ),
    "hero-v3-client-laptop-abstract-ui": (
        "An Italian woman around 35 years old with medium-length wavy hair, wearing a warm sage-green "
        "cardigan over a cream top, seated on a cream linen sofa. Her MacBook is on her lap and she is "
        "gently gesturing with one hand while looking at the screen. "
        "The laptop screen shows ONLY A MINIMAL APPOINTMENT CARD UI — rounded rectangles, a clock icon, "
        "a small calendar tile, soft cream background, NO human face visible on screen, no video call "
        "thumbnail. "
        "Warm interior: terracotta pillow, small ceramic cup, leafy plant out of focus in the background. "
        "Three-quarter angle, mid-shot, natural sunlight from the left. "
        "Mood: someone in the middle of browsing therapists on the app — calm curiosity. "
        + COMMON
    ),
}


def generate(prompt: str, outfile: pathlib.Path, aspect_ratio: str = "3:4"):
    print(f"  → {outfile.name}")
    t0 = time.time()
    result = fal_client.subscribe(
        "fal-ai/nano-banana-pro",
        arguments={
            "prompt": prompt,
            "num_images": 1,
            "aspect_ratio": aspect_ratio,
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
        out = OUT / f"{name}.jpg"
        try:
            generate(prompt, out)
        except Exception as e:
            print(f"    ERROR on {name}: {e}")

    print("\nDone.")


if __name__ == "__main__":
    main()
