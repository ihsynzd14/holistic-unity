# Blog Style Guide

This folder contains **markdown source drafts** for blog posts. They are NOT deployed — the deployed version is the single HTML file at `../<slug>.html`.

The .md here is the source-of-truth for prose you edit; when prose changes, update both the .md AND the corresponding `data-en` / `data-it` / `data-pt` attribute in the HTML.

## Voice Rules (non-negotiable)

1. **No mystical fluff.** No "unlock your potential," "discover the ancient wisdom," "journey of transformation." If the sentence sounds like an Instagram caption, rewrite it.
2. **Specific, not generic.** Not "many people report benefits" — "people who work with this method most commonly report: clearer decision-making, less self-criticism, calmer responses to triggers."
3. **Honest about what it is AND isn't.** Every modality post must explicitly state what the practice does NOT do (cure illness, replace medication, guarantee outcomes). This is a legal AND trust move.
4. **Commercially aware.** The post exists to help the reader decide whether to book a session on Holistic Unity. End with a clear, non-pushy CTA.
5. **Beginner-friendly but not dumbed down.** Assume the reader is a smart adult who hasn't encountered the modality before.

## Structure Template

Every post should answer these three questions, in this order:

1. **What is it?** (short answer, 2–3 paragraphs)
2. **How does it actually work?** (session structure, what to expect physically)
3. **Who is it actually for?** (who it helps + who it does NOT help — explicit)

Then:

4. What you can realistically expect (list of concrete outcomes)
5. Online vs in-person (if applicable)
6. How to choose a practitioner
7. FAQ (4–6 questions, marked up with FAQPage schema)
8. Related posts / cross-links

## Word Count Target

- 1,400–2,200 words (EN equivalent).
- IT and PT translations are not literal — they are localized. Keep the meaning; adjust idiom and rhythm for each language.

## SEO Per Post

- Primary keyword in: title, H1, first 100 words, meta description, URL slug.
- 3–5 secondary keywords naturally distributed.
- Internal links: at least 1 link to a modality page + 1 link to another blog post (once more exist).
- External links: only to genuinely authoritative sources (official certification bodies, peer-reviewed research). No SEO link exchanges.

## Image Requirements

- 1 hero image (1200×675) at the top.
- 2–3 inline images between major H2 sections.
- All images generated via `../../images/blog/_generate_pro.py` (hero/thumbs) and `_generate_inline.py` (inline).
- All silhouettes, no faces. Keep the locked STYLE constant.

## HTML Content Rule

When translating a .md draft into HTML, always include English fallback text as the inner content of the element:

```html
<!-- ✅ -->
<p data-en="Hello" data-it="Ciao" data-pt="Olá">Hello</p>

<!-- ❌ -->
<p data-en="Hello" data-it="Ciao" data-pt="Olá"></p>
```

The second form renders blank if the init JS fails. It also hurts SEO — crawlers see empty paragraphs.

## Checklist Before Deploy

- [ ] All 3 languages present in every translatable element
- [ ] English fallback text as inner content
- [ ] Hero image + 2–3 inline images exist in `images/blog/`
- [ ] Meta tags: title, description, keywords, og:*, twitter:*, canonical, hreflang ×3
- [ ] JSON-LD BlogPosting with ImageObject (url/width/height)
- [ ] Optional: JSON-LD FAQPage if the post has a FAQ
- [ ] Blog index card updated with new post
- [ ] Sitemap.xml updated with new URL (3 hreflang entries)
- [ ] Cross-link added from the relevant modality page
- [ ] `setLang()` + `initLang()` IIFE present in the `<script>` block
- [ ] Local preview (`python3 -m http.server 8000`) — visually verify EN / IT / PT all render
- [ ] Check mobile viewport manually

## Deployment

From `holistic-unity-website/`:

```bash
vercel --prod --yes
```
