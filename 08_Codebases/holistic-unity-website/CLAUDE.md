# Holistic Unity — Marketing Website & Blog

This folder is the **production marketing site** for Holistic Unity, a wellness marketplace connecting people with verified holistic therapists (ThetaHealing, Reiki, Human Design, Astrology, Ayurveda, Numerology, Family / Systemic Constellation, Naturopathy).

- **Live URL:** https://holisticunity.app
- **Owner:** Marcello (Storm X Digital S.R.L.)
- **Stack:** static HTML / CSS / inline JS (no framework). One lightweight Python prerender step for i18n (see below).
- **Hosting:** Vercel — project `prj_WDGMP74Ib3SxEfONAgKCWuaAbnj3`
- **CMS:** none. Content is authored in the `_src/` HTML templates.

> ⚠️ **The root `*.html`, `en/`, and `pt/` pages are GENERATED — do not hand-edit them.**
> Edit the templates in **`_src/`** (they keep the `data-en/it/pt` attributes) and run
> `python scripts/prerender_i18n.py`. See **Build & i18n pipeline** below.

---

## Project Identity

Holistic Unity sells trust. The voice is calm, clear, non-hype, anti-mystical-fluff. Every page — marketing or blog — must:

- Speak plainly. No "unlock your potential," no "discover the power of."
- Be specific and honest. Say what a modality does *and* what it does not do.
- Respect three languages equally: **English, Italian, Portuguese (Brazil)**.
- Match the existing visual system (see Brand Tokens below).

The long-form brand and product context lives at:
`../HOLISTIC_UNITY_KNOWLEDGE_BASE.md` (one level up from this folder)

Read that file before making any strategic copy or positioning decisions.

---

## Folder Structure

```
holistic-unity-website/
├── CLAUDE.md                      # this file
├── README.md                      # human quick-start
├── .vercel/                       # Vercel deployment config (do not edit)
├── index.html                     # homepage
├── thetahealing.html              # 1 per modality (9 total)
├── reiki.html
├── astrology.html
├── human-design.html
├── ayurveda.html
├── numerology.html
├── family-constellation.html
├── systemic-constellation.html
├── naturopathy.html
├── privacy-policy.html            # legal (3 pages, separate translation system)
├── terms-clients.html
├── terms-therapists.html
├── cookie-policy.html
├── shared.css                     # global styles (navbar, footer, reveal animations)
├── sitemap.xml
├── robots.txt
├── blog/
│   ├── index.html                 # blog listing page
│   ├── what-is-theta-healing.html # 1 file per post (single-file multilingual)
│   └── _drafts/                   # markdown source drafts (not deployed)
│       ├── what-is-theta-healing.md
│       └── cos-e-il-theta-healing.md
└── images/
    ├── logo.png, favicon_32.gif
    ├── Reiki.png, ThetaHealing.png, ...   # category illustrations
    └── blog/
        ├── theta-healing-hero.jpg
        ├── theta-healing-session.jpg
        ├── theta-healing-who.jpg
        ├── theta-healing-expectations.jpg
        ├── _generate_pro.py              # reusable FAL AI generator (hero/thumbs)
        ├── _generate_inline.py           # reusable FAL AI generator (inline images)
        └── theta-healing/                # raw generations + alternates
```

---

## Multilingual System

The site supports **EN / IT / PT**. There is no i18n framework. Translations live inline on each element using data attributes:

```html
<p data-en="English text"
   data-it="Testo italiano"
   data-pt="Texto em português">English text</p>
```

A page-level JS function `setLang(lang)` reads `data-${lang}` and sets `innerHTML`. The function runs on page load via an `initLang()` IIFE that:

1. Reads `localStorage.hu_lang` (user's saved choice)
2. Falls back to browser language (`navigator.language`)
3. Falls back to `'en'`
4. Calls `setLang(lang)` which ALSO persists to localStorage

### ⚠️ Critical content rule

**Always include fallback text as the inner content of the element**, not just in the data attributes:

```html
<!-- ✅ GOOD — renders even if JS fails or is slow -->
<p data-en="Hello" data-it="Ciao" data-pt="Olá">Hello</p>

<!-- ❌ BAD — renders empty until setLang() runs -->
<p data-en="Hello" data-it="Ciao" data-pt="Olá"></p>
```

The blog post `what-is-theta-healing.html` was originally written with the BAD pattern (41 elements were empty at first render). It is now mitigated by the `initLang()` IIFE at the end of the `<script>` block, but new content should follow the GOOD pattern regardless, for resilience against JS failures and better SEO (crawlers see actual text).

### Legal pages (privacy-policy, terms-clients, terms-therapists, cookie-policy)

These use a separate system (`setLanguage()` / `toggleLanguage()` with a full duplicated DOM per language). Do not mix the two systems.

---

## Brand Tokens

Palette (from `shared.css` and category pages):

- **Primary magenta:** `#9B0064` (CTAs, link underlines)
- **Deep plum:** `#6B0047` (hover), `#2D1B2E` (headings)
- **Pink tints:** `#FCE4EF` (backgrounds), `#FCF7FA` (soft panels)
- **Body text:** `#3d2d3d`, `#5a4555` (secondary)
- **Muted:** `#8a6a80` (meta), `#eadfe4` (borders)

Gradients:

- Hero: `linear-gradient(135deg, #FCE4EF 0%, #FFF 60%)`
- CTA block: `linear-gradient(135deg, #9B0064 0%, #6B0047 100%)`

Typography: system font stack (see `shared.css`).

### Illustration style — LOCKED

All blog images MUST match the existing category illustrations (`images/Reiki.png`, `images/ThetaHealing.png`, `images/HumanDesign.png`):

- Flat 2D editorial illustration (Tatsuro Kiuchi / Oamul Lu lineage)
- Visible grainy paper texture
- Warm cream / ivory gradient background
- Palette: sage green, dusty mauve, warm beige, terracotta, soft dusty purple, warm gold
- **Silhouette figures, NO facial features** (no eyes, no mouth)
- Overlapping translucent geometric shapes (lotus petals, concentric circles)
- Soft radial halo of warm gold light

To generate a new image: duplicate `images/blog/_generate_pro.py`, change the `SCENES` dict, keep the `STYLE` constant identical. See the next section.

---

## Image Generation Standard (FAL AI)

Two scripts live in `images/blog/`:

- `_generate_pro.py` — uses `fal-ai/flux-pro/v1.1` for hero / thumbnail images (4 variants per run)
- `_generate_inline.py` — same model, same style, for inline section-break images

Both share a locked `STYLE` string. Never edit the `STYLE` constant unless doing a deliberate rebrand.

**Known-good model:** `fal-ai/flux-pro/v1.1` with prompt-only style control.
**Rejected:** `fal-ai/flux-pro/v1.1/redux` (content-aware — copies composition from reference image, does not produce style transfer). Do not use this model for brand-consistent generation.

**FAL API key** is NOT committed. User stores it in their shell; pass via `FAL_KEY=... python3 _generate_pro.py`.

**Output cost:** ~$0.04 per image at flux-pro v1.1 quality. A new blog post typically needs 1 hero + 3 inline = ~$0.16.

---

## Blog Authoring Conventions

### Publication velocity (recommendation)

**Recommended cadence: 3-4 posts per week, not daily.** The original calendar (`blog/_drafts/PIANO_EDITORIALE_30_GIORNI.md`) targets 1 post/day for 30 days; this is high-velocity content production that, on a young domain, can be read by Google as a content-farming pattern regardless of per-post quality. To preserve E-E-A-T credit on a YMYL site:

- Aim for **3-4 substantive posts per week**, ideally on Mon / Wed / Fri (+ optional Sat).
- On posting days, give each article the time it needs for sources research and copy review.
- Use the off-days for: revisiting older posts (refresh sources, dates, internal links), responding to GSC issues, building backlinks.
- The calendar in `PIANO_EDITORIALE_30_GIORNI.md` is the **content backlog**, not a daily quota — work through it at the recommended cadence.

This is a recommendation, not a hard rule. The user (Marcello) decides the actual pace based on observed GSC signals.

---

### ⚠️ Editorial standards (mandatory — YMYL compliance)

The wellness sector is **YMYL (Your Money or Your Life)** under Google's Search Quality Guidelines. Health-adjacent content without trust signals risks ranking penalties. Every new blog post MUST include:

**1. Editorial note** at the top of the body, immediately before the first H2:

```html
<div class="editorial-note">
  <strong data-en="Editorial note" data-it="Nota editoriale" data-pt="Nota editorial">Nota editoriale</strong>
  <span data-en=" — Article by the Holistic Unity editorial team. Updated [DATE]. Informational content; does not replace professional advice. See Sources at the end."
        data-it=" — Articolo della redazione di Holistic Unity. Aggiornato al [DATE]. Contenuto informativo; non sostituisce un parere professionale. Vedi Fonti in fondo."
        data-pt=" — Artigo da redação da Holistic Unity. Atualizado em [DATE]. Conteúdo informativo; não substitui parecer profissional. Veja Fontes no final."> — [fallback in primary language]</span>
</div>
```

**2. Sources section** at the end of the body, immediately before the FAQ H2 (`Domande frequenti` / `Frequently asked`):

```html
<div class="sources-section">
  <h3 data-en="Sources and references" data-it="Fonti e riferimenti" data-pt="Fontes e referências">Fonti e riferimenti</h3>
  <ul>
    <li>...verified source with real, working URL...</li>
  </ul>
  <p class="sources-meta">Ultima revisione: [DATE]. La redazione di Holistic Unity verifica link e riferimenti normativi a ogni aggiornamento sostanziale.</p>
</div>
```

**3. Required CSS** (add to inline `<style>` block, taken from `come-diventare-operatore-olistico.html`):

```css
.editorial-note { background: #FCF7FA; border-left: 3px solid #9B0064; padding: 16px 20px; margin: 24px 0 32px; border-radius: 4px; font-size: 0.95rem; color: #5a4555; line-height: 1.6; }
.editorial-note strong { color: #2D1B2E; }
.sources-section { background: #FCF7FA; border-radius: 16px; padding: 28px 32px; margin: 40px 0 0; }
.sources-section h3 { color: #2D1B2E; font-size: 1.15rem; margin: 0 0 16px; }
.sources-section ul { padding-left: 20px; margin: 0; }
.sources-section li { font-size: 0.95rem; line-height: 1.7; color: #3d2d3d; margin-bottom: 10px; }
.sources-section a { color: #9B0064; text-decoration: underline; text-underline-offset: 2px; word-break: break-word; }
.sources-section .sources-meta { font-size: 0.85rem; color: #8a6a80; margin-top: 16px; padding-top: 14px; border-top: 1px solid #eadfe4; font-style: italic; }
```

### Source rules — non-negotiable

- **Minimum 3 sources** per post; aim for 5+ on health-adjacent topics (Reiki, ThetaHealing®, Naturopathy, Ayurveda).
- **Only verified URLs.** Never invent or guess URLs. If unsure of the exact URL, cite the institution by name without a link rather than fabricate one.
- **Prefer institutional / regulatory / peer-reviewed sources.** Safe examples:
  - Italian law: `gazzettaufficiale.it`
  - Italian tax authority: `agenziaentrate.gov.it`
  - Italian standards body: `store.uni.com`, `uni.com` (UNI 11713 regulates "Operatore Olistico" in IT)
  - Research: `pubmed.ncbi.nlm.nih.gov`, `cochranelibrary.com`, `ncbi.nlm.nih.gov`
  - Italian health authority: `iss.it`, `salute.gov.it`
  - WHO: `who.int`
  - Discipline-specific official bodies: `thetahealing.com` (THInK), recognised Reiki lineages, etc.
- **Avoid as primary sources:** generic blogs, Wikipedia, commercial wellness sites, social media.
- **For Italian regulatory claims** (operator certification, tax regime), cite Law 4/2013, UNI 11713, or the relevant Agenzia delle Entrate page.
- **For research claims** about a discipline's effects, cite a PubMed-indexed study by author, year, and journal — link only if the URL is verified.

### Author attribution

The site does not currently use a single named author byline. Trust is established via:
- The editorial note on each article
- The [About page](/about.html) describing editorial standards, practitioner verification, and ownership (Storm X Digital S.R.L.)
- The Sources section listing identifiable, verifiable references

If a single named author is added in the future, update CLAUDE.md and the editorial note pattern accordingly.

---

### Other content rules

Each blog post is a **single HTML file** at `blog/<slug>.html` with all 3 languages in data attributes. Do not create one file per language.

### Required meta tags (copy from `what-is-theta-healing.html`):

- `description`, `keywords`, `author`, `robots`
- `og:type=article`, `og:title`, `og:description`, `og:image` (+ width/height/alt), `og:url`
- `twitter:card=summary_large_image`, `twitter:*`
- `canonical` URL
- `hreflang` entries for en/it/pt + `x-default` (all pointing to the same single-file URL)
- `<script type="application/ld+json">` BlogPosting schema with ImageObject (url/width/height) — NOT a bare image URL
- Optional FAQPage schema if the post has a FAQ section

### Required page sections:

1. Navbar (copy from existing post — includes nav links + language toggle)
2. Article hero: breadcrumb, pill tag, meta (date + read time), H1, lede, hero image
3. **Editorial note** (immediately inside `.article-body > .container`, before first H2) — see Editorial standards above
4. Article body: H2 sections with inline figures between major breaks
5. CTA block linking to the relevant modality page
6. **Sources section** (`.sources-section`, before the FAQ H2) — see Editorial standards above
7. FAQ section (marked up with FAQPage schema)
8. "Keep exploring" related-posts block
9. Footer (copy from existing post — with Blog link AND About link in Platform column)
10. `<script>` with `setLang()` function AND `initLang()` IIFE at the end

### Image requirements per post:

- 1 hero image, 1200×675 — filename: `theta-healing-hero.jpg` → `<slug>-hero.jpg`
- 2–3 inline images, 1200×675 — filename: `<slug>-<topic>.jpg`
- Update OG/Twitter meta + BlogPosting JSON-LD `image` to the hero

### Update sitemap after publishing:

Add 3 entries (`<xhtml:link rel="alternate" hreflang="..."/>`) for the new URL in `sitemap.xml`.

### Cross-link from the related modality page:

Add a "New to [modality]?" section above the therapist strip, linking to the new blog post. See `thetahealing.html` for the pattern.

---

## Build & i18n pipeline

The site is statically prerendered into one URL per language so each language is
independently indexable (previously all 3 languages lived on one URL via client-side
`setLang()`, so Google only indexed one, and hreflang pointed every language at the
same URL — non-functional). **Italian is the bare/default + x-default; English →
`/en/…`, Portuguese → `/pt/…`.** Additive: no redirects; existing URLs are unchanged.

**Source of truth = `_src/`** (the 13 marketing + 34 blog templates, with `data-*`
attributes intact). The deployed pages are generated:

| Source | Generates |
|---|---|
| `_src/reiki.html` | `reiki.html` (it) · `en/reiki.html` · `pt/reiki.html` |

**Rebuild after any content edit (edit `_src/`, then):**

```bash
# 1. image pipeline (run on _src BEFORE prerender)
python scripts/optimize_images.py       # WebP + light JPG fallbacks for new images
python scripts/rewrite_images_html.py   # wrap new <img> in <picture> + repoint OG
python scripts/rewrite_bg_images.py     # CSS background-image PNG → image-set(webp,jpg)
python scripts/add_image_dims.py        # width/height (CLS) + lazy/eager + hero fetchpriority
# 2. prerender + sitemap
python scripts/prerender_i18n.py    # bake _src → root(it) + en/ + pt/  (per-lang
                                    # title/desc/OG/canonical/hreflang, toggle→links,
                                    # localized JSON-LD/FAQ, data-* stripped, window.HU_LANG)
python scripts/generate_sitemap.py  # trilingual sitemap.xml with hreflang clusters
```

JSON-LD is localized per language by the prerender: `inLanguage` is set, FAQPage
`mainEntity` is rebuilt from the baked (correct-language) visible FAQ, and
Service/BlogPosting descriptions are synced to the page's per-language description.

Notes:
- `scripts/prerender_i18n.py` reads meta per language from the H1 (`data-{lang}`) +
  hero lede; EN keeps its hand-crafted `<title>`. Legal pages (privacy/terms/cookie)
  use a *different* translation system and are **excluded** from the prerender.
- `shared.js` `initLang()` early-returns when `window.HU_LANG` is set (baked pages),
  so it never re-switches the static content.
- `_src/` is in `.vercelignore` (templates must not be served as duplicate content).
- Image work order: run the image scripts against `_src/` so the `<picture>` markup
  is baked into all language outputs by the prerender.

## Deployment

Vercel is configured. **Rebuild first** (prerender + sitemap), then from this folder:

```bash
python scripts/prerender_i18n.py && python scripts/generate_sitemap.py
vercel --prod --yes
```

This deploys directly to https://holisticunity.app. No preview flow, no CI. Vercel
`cleanUrls` serves `en/reiki.html` at `/en/reiki` automatically.

Authentication: the user is already logged into Vercel locally. Do not modify `.vercel/project.json`.

---

## Known Issues / Open Review Items

### High priority (user-reported)

- [ ] **Full UX/UI audit across all 13 pages** (marketing + blog) — user reports visible defects. Focus areas: spacing consistency, mobile layout, hover states, form validation states, empty/loading states.
- [ ] **Cross-browser check** — Safari, Chrome, Firefox, mobile Safari.
- [ ] **Accessibility audit** — keyboard navigation, focus visibility, alt text completeness, ARIA labels on icon-only buttons (`toggleMenu`, language buttons), color contrast on `#5a4555` text over pink bg.

### Content / SEO

- [ ] **Hreflang correctness** — current setup has all 3 hreflang entries pointing to the same URL (because translations are in-page via JS). Verify this is what Google actually wants for this pattern, or switch to `?lang=it` URL params with prerendered variants.
- [ ] **OG image consistency** — most modality pages do not have unique OG images. Decide: generate per-modality OG or use a shared brand OG.
- [ ] **Meta description length** — audit all pages for 150–160 char target.
- [ ] **Schema markup** — only blog has BlogPosting. Consider adding Organization / Service / Product schema on the main pages.

### Performance

- [ ] **Image optimization** — all blog images are ~80–230 KB JPEGs. Consider WebP/AVIF with fallback. Hero uses `fetchpriority="high"` but inline images are only `loading="lazy"`.
- [ ] **Font loading** — currently system fonts only. If this changes, add `rel="preload"`.
- [ ] **Inline CSS size** — some pages have >300 lines of inline CSS. Consider extracting more to `shared.css`.

### Code quality

- [ ] Each HTML page duplicates the entire navbar, footer, and `setLang` script. A minimal JS include or HTML partial system (at build time via a simple script, not a framework) would remove ~300 lines per page.
- [ ] `setLang` is duplicated across 10 marketing pages + 2 blog pages. Extract to `shared.js`.
- [ ] `reveal` animation class depends on IntersectionObserver — ensure it's applied consistently, and verify it doesn't hide initial-viewport content on slow connections.
- [ ] Blog post previously had `reveal-left` class on the article-hero container — this pattern hid the hero until scroll observer fired. Already removed from `what-is-theta-healing.html`. Do not reintroduce on any in-viewport-by-default content.

### Content backlog

- [ ] More blog posts: "Reiki for beginners", "How to read your Human Design chart", "Astrology vs Human Design", "What happens in a Family Constellation session".
- [ ] Therapist-facing landing page dedicated to the Italian market (current `index.html#therapists` is short).

---

## Commit / Deploy Workflow

No git workflow defined in this folder yet. If Claude Code initializes git, suggest:

- Commit per logical change (not per file)
- Commit message style: `area: short summary` (e.g., `blog: add hero and inline images`)
- Deploy only from `main` / trunk after a local eyeball check
- Never deploy unreviewed AI-generated content — always read the final HTML and check rendered text before pushing

---

## What NOT to Do

- Do not introduce a framework (React, Vue, Astro, Next). The site is static by design.
- Do not add a build step that isn't strictly necessary.
- Do not touch the three legal pages' translation system without reading both of them first — they use a different pattern than the rest of the site.
- Do not commit the FAL API key.
- Do not use `fal-ai/flux-pro/v1.1/redux` for image generation.
- Do not write blog paragraphs with only data-* attributes and no fallback text.
- Do not reproduce copyrighted content (e.g., song lyrics, long quotes from other sites).
- **NEVER write "Theta Healing" (two words).** The brand name is always **ThetaHealing®** — one word, capital T and H, with the ® symbol. This applies to all languages (EN, IT, PT), all contexts (headings, body text, meta tags, JSON-LD, alt text), and all pages. The only exceptions are URL slugs and file names (which use lowercase hyphens: `theta-healing`).

---

## Related Folders (outside this one)

- `../HOLISTIC_UNITY_KNOWLEDGE_BASE.md` — brand strategy, voice, audience
- `../iOS App/` — the mobile app (separate project)
- `../admin-dashboard/` — internal admin tool
- `../therapist-webapp/` — therapist-facing web portal
- `../supabase-edge-functions/` — backend
- `../content/` — marketing asset library (fumetti, captions, prompts)
- `../Images Categories/` — source category illustrations
