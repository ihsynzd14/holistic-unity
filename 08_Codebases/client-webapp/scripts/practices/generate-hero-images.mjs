#!/usr/bin/env node
/**
 * Generate FAL hero images for the 9 published practices and write the
 * resulting URLs into public.practices.hero_image_url.
 *
 * Visual brief (per Holistic Unity brand):
 *   - Warm cream background (#FBF0E9 family), no text, single iconic subject
 *   - Minimal flat illustration, soft amber/gold gradients with berry accents
 *   - Slight mystical glow, organic curves, no harsh edges
 *   - Centred composition that reads at thumbnail size and at full hero width
 *   - Style is consciously the same as the 7 onboarding heroes already in
 *     /public/onboarding/heroes/ so the visual language is unified across
 *     the app
 *
 * Usage:
 *   FAL_KEY=...:... \
 *   SUPABASE_URL=https://....supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/practices/generate-hero-images.mjs
 *
 * Defaults to the FAL_KEY hard-coded in `generate_onboarding_assets.py`
 * if no env var is set, since this is an internal admin script and we
 * already use that key elsewhere in the workspace.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../../public/practices/heroes");

const FAL_KEY =
  process.env.FAL_KEY ||
  "4f347508-07be-488e-ac3f-8789a32cfdba:3f82caa36ae472e8f2570052511e9c9f";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://bqyqkvkzkemiwyqjkbna.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 16:9 landscape — works as a card banner (height auto on mobile) and as a
// full-width hero on the detail page. flux/schnell renders these in ~3s.
const IMAGE_WIDTH = 1024;
const IMAGE_HEIGHT = 576;

// Shared style suffix appended to every prompt so all 9 images feel like
// part of the same set. Keep this in sync with the onboarding hero style.
const STYLE_SUFFIX = `
Style: minimal flat illustration, slightly dreamy, organic curves, soft gradients.
Background: warm cream #FBF0E9, no text, no letters, no symbols of religion.
Palette: amber #D9A05A, gold #C9A96E, soft berry #8B2252 accents, warm cream.
Composition: centred iconic subject, generous negative space, soft glow halo.
No people, no faces, no hands holding objects, no medical equipment.
Soft watercolour feel, painted with light, gentle and inviting.`.trim();

// --- Per-practice prompts -------------------------------------------------
// Each prompt is a single iconic image that captures the *essence* of the
// practice without being literal. Avoid clichés (e.g. yoga poses) — pick
// the unique symbol that's most recognisable for that modality.
const PRACTICES = [
  {
    slug: "theta-healing",
    prompt: `A glowing third-eye lotus floating in space, soft theta brainwave lines undulating gently behind it, faint constellation dots, an inner amber light radiating outward like a sunrise.`,
  },
  {
    slug: "costellazioni-familiari",
    prompt: `An ancient tree of life with golden leaves, its roots forming a delicate constellation of small luminous orbs connected by thin amber threads, suggesting generations linked across time. Soft glow at the trunk's centre.`,
  },
  {
    slug: "costellazioni-sistemiche",
    prompt: `An abstract sacred geometry — interconnected golden circles forming a flower-of-life pattern, with delicate amber lines linking nodes like a network of relationships, soft halo at the centre.`,
  },
  {
    slug: "reiki",
    prompt: `Two soft cupped half-circles of warm amber light facing each other, with gentle wave-like ribbons of energy flowing between them, suggesting the transmission of universal life force. No human anatomy visible.`,
  },
  {
    slug: "naturopatia",
    prompt: `A botanical still-life: a small sprig of wild herbs (rosemary, sage, eucalyptus leaves) arranged with a single dried flower and a soft amber drop of essence, painted in warm watercolour tones.`,
  },
  {
    slug: "astrologia",
    prompt: `A minimalist celestial map: a soft arc of zodiac symbols rendered as delicate gold line work across a cream sky, with three luminous stars and a crescent moon glowing warm amber.`,
  },
  {
    slug: "human-design",
    prompt: `An abstract bodygraph chart: nine geometric centres (triangles and squares) connected by thin gold channels, arranged vertically in a simple poetic diagram, glowing softly with amber accents.`,
  },
  {
    slug: "numerologia",
    prompt: `A spiral of softly painted numerals (3, 7, 9, 11, 22) flowing in a Fibonacci curve, each digit gently glowing in amber gold against warm cream, with subtle sacred geometry overlay.`,
  },
  {
    slug: "ayurveda",
    prompt: `A warm brass bowl with steaming spiced herbal tea, a small lotus flower floating on the surface, surrounded by tiny scattered cardamom pods and a single cinnamon stick, painted in warm amber watercolour.`,
  },
];

// --- FAL helpers ----------------------------------------------------------
async function fal(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`FAL ${method} ${url} → ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function generate(prompt) {
  // Submit job to flux/schnell queue
  const submitted = await fal(
    "POST",
    "https://queue.fal.run/fal-ai/flux/schnell",
    {
      prompt: `${prompt}\n\n${STYLE_SUFFIX}`,
      image_size: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
      num_images: 1,
      num_inference_steps: 4,
      enable_safety_checker: true,
    },
  );

  // Poll status until COMPLETED (usually 2-4 seconds)
  let attempt = 0;
  while (attempt++ < 60) {
    await new Promise((r) => setTimeout(r, 1500));
    const status = await fal("GET", submitted.status_url);
    if (status.status === "COMPLETED") break;
    if (status.status === "FAILED") {
      throw new Error(`FAL job failed: ${JSON.stringify(status)}`);
    }
  }

  // Fetch result
  const result = await fal("GET", submitted.response_url);
  const url = result.images?.[0]?.url;
  if (!url) throw new Error(`No image URL in result: ${JSON.stringify(result)}`);
  return url;
}

async function downloadJpg(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download ${url} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  return dest;
}

// --- Supabase update -----------------------------------------------------
async function updatePractice(slug, heroUrl) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.log(
      `  [dry] would set practices.hero_image_url = ${heroUrl} where slug = ${slug}`,
    );
    return;
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/practices?slug=eq.${encodeURIComponent(slug)}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ hero_image_url: heroUrl }),
    },
  );
  if (!res.ok) {
    throw new Error(`DB update failed for ${slug}: ${res.status} ${await res.text()}`);
  }
  console.log(`  ✓ DB updated: ${slug} → ${heroUrl}`);
}

// --- Main ----------------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });

console.log(`Generating ${PRACTICES.length} hero images at ${IMAGE_WIDTH}x${IMAGE_HEIGHT}…`);
console.log(`  → ${OUT_DIR}\n`);

for (const p of PRACTICES) {
  console.log(`[${p.slug}]`);
  try {
    const remoteUrl = await generate(p.prompt);
    console.log(`  • generated: ${remoteUrl.slice(0, 70)}…`);

    const localPath = resolve(OUT_DIR, `${p.slug}.jpg`);
    await downloadJpg(remoteUrl, localPath);
    console.log(`  • saved → public/practices/heroes/${p.slug}.jpg`);

    // The path stored in the DB must be web-relative (served by Next.js
    // from /public). The deployed site at app.holisticunity.app reads it
    // via a normal <Image src="/practices/heroes/{slug}.jpg" />.
    const heroUrl = `/practices/heroes/${p.slug}.jpg`;
    await updatePractice(p.slug, heroUrl);
  } catch (err) {
    console.error(`  ✗ FAILED: ${err.message}`);
  }
  console.log();
}

console.log("Done.");
